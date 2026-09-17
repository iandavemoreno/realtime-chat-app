const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// In a real deployment this comes from an environment variable / secret
// manager and is never committed to source control. A fallback constant
// keeps setup simple for this practice project.
const JWT_SECRET = process.env.JWT_SECRET || 'realtime-chat-dev-secret-change-me';
const TOKEN_EXPIRY = '7d';

const db = new Database(path.join(__dirname, 'chat.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

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

function signToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// Protects a REST route: requires a valid "Authorization: Bearer <token>"
// header and attaches the verified username to the request.
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.username = payload.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// ---- Auth ----

app.post('/api/auth/signup', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'That username is already taken' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);

  res.status(201).json({ token: signToken(username), username });
});

app.post('/api/auth/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // Same generic error whether the username doesn't exist or the password
  // is wrong — this avoids confirming to an attacker which usernames are
  // actually registered.
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  res.json({ token: signToken(username), username });
});

// ---- Rooms ----

app.get('/api/rooms', requireAuth, (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY id ASC').all();
  res.json(rooms);
});

app.post('/api/rooms', requireAuth, (req, res) => {
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

app.get('/api/messages', requireAuth, (req, res) => {
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

app.get('/api/dms', requireAuth, (req, res) => {
  const { user1, user2 } = req.query;
  if (!user1 || !user2) {
    return res.status(400).json({ error: 'user1 and user2 query params are required' });
  }
  // Only the two people in the conversation may read it back.
  if (req.username !== user1 && req.username !== user2) {
    return res.status(403).json({ error: "You can't view another pair's conversation" });
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

// Test-only helper: wipe all data and reseed the two default rooms, so the
// Playwright suite can start every run from a known, clean state.
app.post('/api/test-reset', (req, res) => {
  db.exec('DELETE FROM messages; DELETE FROM direct_messages; DELETE FROM rooms; DELETE FROM users;');
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

// Every socket connection must present a valid JWT up front. This runs
// before 'connection', so a socket's username is verified cryptographically
// before any event handler ever sees it — nobody can claim to be someone
// else just by sending a different name in an event payload (the way the
// old display-name-only version worked).
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.username = payload.username;
    next();
  } catch (err) {
    next(new Error('Invalid or expired session'));
  }
});

io.on('connection', (socket) => {
  let currentRoomId = null;

  onlineUsers.set(socket.username, socket.id);
  io.emit('users-online', Array.from(onlineUsers.keys()));

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

  socket.on('send-message', ({ roomId, text }) => {
    // The sender's name comes from the authenticated socket, never from
    // the event payload — so a message can never be posted under someone
    // else's identity.
    const username = socket.username;
    if (!roomId || !text || !text.trim()) return;

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

  // "socket.to" (unlike "io.to") broadcasts to everyone else in the room
  // except the sender — exactly what a typing indicator needs.
  socket.on('typing', ({ roomId, isTyping }) => {
    if (!roomId) return;
    socket.to(roomChannel(roomId)).emit('user-typing', {
      roomId,
      username: socket.username,
      isTyping: !!isTyping,
    });
  });

  socket.on('typing-dm', ({ toUsername, isTyping }) => {
    if (!toUsername) return;
    const targetSocketId = onlineUsers.get(toUsername);
    if (targetSocketId) {
      io.to(targetSocketId).emit('user-typing-dm', {
        fromUsername: socket.username,
        isTyping: !!isTyping,
      });
    }
  });

  socket.on('disconnect', () => {
    if (currentRoomId) {
      // Let the room know immediately, rather than leaving a stale "is
      // typing" indicator up until the client-side safety timeout expires.
      socket.to(roomChannel(currentRoomId)).emit('user-typing', {
        roomId: currentRoomId,
        username: socket.username,
        isTyping: false,
      });
      socket.leave(roomChannel(currentRoomId));
    }
    if (onlineUsers.get(socket.username) === socket.id) {
      onlineUsers.delete(socket.username);
      io.emit('users-online', Array.from(onlineUsers.keys()));
    }
  });
});

const PORT = process.env.PORT || 3004;
server.listen(PORT, () => {
  console.log(`Chat server running on http://localhost:${PORT}`);
});
