import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SOCKET_URL = 'http://localhost:3004';

function App() {
  const [username, setUsername] = useState('');
  const [joined, setJoined] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const [rooms, setRooms] = useState([]);
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [newRoomName, setNewRoomName] = useState('');

  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [roomReady, setRoomReady] = useState(false);

  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Connect once after joining, and load the room list
  useEffect(() => {
    if (!joined) return;

    const socket = io(SOCKET_URL);
    socketRef.current = socket;

    fetch(`${SOCKET_URL}/api/rooms`)
      .then((res) => res.json())
      .then(setRooms);

    socket.on('room-created', (room) => {
      setRooms((prev) => [...prev, room]);
    });

    return () => {
      socket.disconnect();
    };
  }, [joined]);

  // Once rooms load, default to the first one
  useEffect(() => {
    if (rooms.length > 0 && currentRoomId === null) {
      setCurrentRoomId(rooms[0].id);
    }
  }, [rooms, currentRoomId]);

  // Whenever the selected room changes: join its socket channel and load its history
  useEffect(() => {
    if (!currentRoomId || !socketRef.current) return;
    const socket = socketRef.current;

    setRoomReady(false);
    socket.emit('join-room', { roomId: currentRoomId }, () => {
      // Only now is this socket guaranteed to be registered server-side to
      // receive broadcasts for this room.
      setRoomReady(true);
    });

    fetch(`${SOCKET_URL}/api/messages?roomId=${currentRoomId}`)
      .then((res) => res.json())
      .then(setMessages);

    function handleNewMessage(message) {
      if (message.room_id === currentRoomId) {
        setMessages((prev) => [...prev, message]);
      }
    }

    socket.on('new-message', handleNewMessage);
    return () => {
      socket.off('new-message', handleNewMessage);
    };
  }, [currentRoomId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleJoin(e) {
    e.preventDefault();
    if (!nameInput.trim()) return;
    setUsername(nameInput.trim());
    setJoined(true);
  }

  function handleSend(e) {
    e.preventDefault();
    if (!messageInput.trim() || !currentRoomId) return;
    socketRef.current.emit('send-message', {
      roomId: currentRoomId,
      username,
      text: messageInput,
    });
    setMessageInput('');
  }

  async function handleCreateRoom(e) {
    e.preventDefault();
    const name = newRoomName.trim();
    if (!name) return;

    const res = await fetch(`${SOCKET_URL}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    if (res.ok) {
      const room = await res.json();
      setNewRoomName('');
      // The room itself gets added to the sidebar via the "room-created"
      // socket broadcast (so every connected client sees it, not just us) —
      // here we just jump straight into the new room.
      setCurrentRoomId(room.id);
    }
  }

  if (!joined) {
    return (
      <div className="join-screen">
        <form onSubmit={handleJoin}>
          <h1>Realtime Chat</h1>
          <input
            type="text"
            placeholder="Enter your display name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            autoFocus
          />
          <button type="submit">Join Chat</button>
        </form>
      </div>
    );
  }

  const currentRoom = rooms.find((r) => r.id === currentRoomId);

  return (
    <div className="chat-app">
      <aside className="room-sidebar">
        <h2>Rooms</h2>
        <ul className="room-list">
          {rooms.map((room) => (
            <li key={room.id}>
              <button
                className={`room-item ${room.id === currentRoomId ? 'active' : ''}`}
                onClick={() => setCurrentRoomId(room.id)}
              >
                {room.name}
              </button>
            </li>
          ))}
        </ul>
        <form className="new-room-form" onSubmit={handleCreateRoom}>
          <input
            type="text"
            placeholder="New room name"
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
          />
          <button type="submit">+ Add</button>
        </form>
      </aside>

      <div className="chat-main">
        <header className="chat-header">
          <h1>{currentRoom ? currentRoom.name : 'Realtime Chat'}</h1>
          <span className="current-user">Logged in as {username}</span>
        </header>

        <div className="messages-list">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`message ${msg.username === username ? 'own-message' : ''}`}
            >
              <span className="message-username">{msg.username}</span>
              <p className="message-text">{msg.text}</p>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {roomReady ? (
          <form className="message-form" onSubmit={handleSend}>
            <input
              type="text"
              placeholder="Type a message..."
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              autoFocus
            />
            <button type="submit">Send</button>
          </form>
        ) : (
          <div className="message-form message-form-loading">Joining room…</div>
        )}
      </div>
    </div>
  );
}

export default App;
