import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SOCKET_URL = 'http://localhost:3004';

function App() {
  const [username, setUsername] = useState('');
  const [joined, setJoined] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!joined) return;

    // Load chat history
    fetch(`${SOCKET_URL}/api/messages`)
      .then((res) => res.json())
      .then((data) => setMessages(data));

    // Connect socket
    const socket = io(SOCKET_URL);
    socketRef.current = socket;

    socket.on('new-message', (message) => {
      setMessages((prev) => [...prev, message]);
    });

    return () => {
      socket.disconnect();
    };
  }, [joined]);

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
    if (!messageInput.trim()) return;
    socketRef.current.emit('send-message', { username, text: messageInput });
    setMessageInput('');
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

  return (
    <div className="chat-app">
      <header className="chat-header">
        <h1>Realtime Chat</h1>
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
    </div>
  );
}

export default App;