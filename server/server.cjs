const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database(path.join(__dirname, 'chat.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS direct_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_username TEXT NOT NULL,
    to_username TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Seed two default rooms the first time the app ever runs
const roomCount = db.prepare('SELECT COUNT(*) AS count FROM rooms').get().count;
if (roomCount === 0) {
  const insertRoom = db.prepare('INSERT INTO rooms (name) VALUES (?)');
  insertRoom.run('General');
  insertRoom.run('Random');
}

// ---- Rooms ----

app.get('/api/rooms', (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY id ASC').all();
  res.json(rooms);
});

app.post('/api/rooms', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Room name is required' });
  }

  const existing = db.prepare('SELECT * FROM rooms WHERE name = ?').get(name);
  if (existing) {
    return res.status(409).json({ error: 'A room with that name already exists' });
  }

  const result = db.prepare('INSERT INTO rooms (name) VALUES (?)').run(name);
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(result.lastInsertRowid);

  // Let every connected client know a new room exists, live
  io.emit('room-created', room);

  res.status(201).json(room);
});

// ---- Messages (scoped to a room) ----

app.get('/api/messages', (req, res) => {
  const roomId = Number(req.query.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'roomId query param is required' });
  }
  const messages = db
    .prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY id ASC LIMIT 100')
    .all(roomId);
  res.json(messages);
});

// ---- Direct messages (private, between two users) ----

app.get('/api/dms', (req, res) => {
  const { user1, user2 } = req.query;
  if (!user1 || !user2) {
    return res.status(400).json({ error: 'user1 and user2 query params are required' });
  }
  const messages = db
    .prepare(
      `SELECT * FROM direct_messages
       WHERE (from_username = ? AND to_username = ?) OR (from_username = ? AND to_username = ?)
       ORDER BY id ASC LIMIT 100`
    )
    .all(user1, user2, user2, user1);
  res.json(messages);
});

// Test-only helper: wipe all rooms/messages and reseed the two defaults, so
// the Playwright suite can start every run from a known, clean state.
app.post('/api/test-reset', (req, res) => {
  db.exec('DELETE FROM messages; DELETE FROM direct_messages; DELETE FROM rooms;');
  const insertRoom = db.prepare('INSERT INTO rooms (name) VALUES (?)');
  insertRoom.run('General');
  insertRoom.run('Random');
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY id ASC').all();
  res.json({ ok: true, rooms });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

function roomChannel(roomId) {
  return `room-${roomId}`;
}

// Tracks which socket a username is currently connected on, so direct
// messages can be routed straight to them and the "who's online" list can
// be broadcast to everyone.
const onlineUsers = new Map();

io.on('connection', (socket) => {
  let currentRoomId = null;

  // A client registers its display name right after joining the app. Other
  // features (DMs, the online-users list) wait on this ack the same way
  // room-joins wait on their own ack, so a message can never be routed
  // before the server actually knows who this socket belongs to.
  socket.on('register-user', ({ username }, callback) => {
    socket.username = username;
    onlineUsers.set(username, socket.id);
    io.emit('users-online', Array.from(onlineUsers.keys()));
    if (typeof callback === 'function') callback();
  });

  socket.on('join-room', ({ roomId }, callback) => {
    if (currentRoomId) {
      socket.leave(roomChannel(currentRoomId));
    }
    currentRoomId = roomId;
    socket.join(roomChannel(roomId));
    // Acknowledge back to the client once this socket is actually
    // registered in the room's channel — the client waits for this before
    // treating itself as "ready", closing a race where a message could be
    // broadcast before a just-joined client is listening for it.
    if (typeof callback === 'function') callback();
  });

  socket.on('send-message', ({ roomId, username, text }) => {
    if (!roomId || !username || !text || !text.trim()) return;

    const stmt = db.prepare('INSERT INTO messages (room_id, username, text) VALUES (?, ?, ?)');
    const result = stmt.run(roomId, username, text.trim());

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);

    // Only broadcast to clients currently joined to this room
    io.to(roomChannel(roomId)).emit('new-message', message);
  });

  socket.on('send-dm', ({ toUsername, text }) => {
    const fromUsername = socket.username;
    if (!fromUsername || !toUsername || !text || !text.trim()) return;

    const stmt = db.prepare(
      'INSERT INTO direct_messages (from_username, to_username, text) VALUES (?, ?, ?)'
    );
    const result = stmt.run(fromUsername, toUsername, text.trim());
    const message = db.prepare('SELECT * FROM direct_messages WHERE id = ?').get(result.lastInsertRowid);

    // Route privately: only the sender and the recipient's current socket
    // (if they're online) ever see this — never a room-wide broadcast.
    const targetSocketId = onlineUsers.get(toUsername);
    if (targetSocketId) {
      io.to(targetSocketId).emit('new-dm', message);
    }
    socket.emit('new-dm', message);
  });

  socket.on('disconnect', () => {
    if (currentRoomId) {
      socket.leave(roomChannel(currentRoomId));
    }
    if (socket.username && onlineUsers.get(socket.username) === socket.id) {
      onlineUsers.delete(socket.username);
      io.emit('users-online', Array.from(onlineUsers.keys()));
    }
  });
});

const PORT = process.env.PORT || 3004;
server.listen(PORT, () => {
  console.log(`Chat server running on http://localhost:${PORT}`);
});
