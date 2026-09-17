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
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Fetch chat history
app.get('/api/messages', (req, res) => {
  const messages = db.prepare('SELECT * FROM messages ORDER BY id ASC LIMIT 100').all();
  res.json(messages);
});

// Test-only helper: wipe all messages so the suite can start from a clean slate
app.delete('/api/messages', (req, res) => {
  db.prepare('DELETE FROM messages').run();
  res.json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

io.on('connection', (socket) => {
  console.log('a user connected:', socket.id);

  socket.on('send-message', ({ username, text }) => {
    if (!username || !text || !text.trim()) return;

    const stmt = db.prepare('INSERT INTO messages (username, text) VALUES (?, ?)');
    const result = stmt.run(username, text.trim());

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);

    // Broadcast to everyone, including the sender
    io.emit('new-message', message);
  });

  socket.on('disconnect', () => {
    console.log('a user disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3004;
server.listen(PORT, () => {
  console.log(`Chat server running on http://localhost:${PORT}`);
});
