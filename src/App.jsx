import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SOCKET_URL = 'http://localhost:3004';

function App() {
  const [username, setUsername] = useState('');
  const [joined, setJoined] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [registered, setRegistered] = useState(false);

  const [rooms, setRooms] = useState([]);
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [newRoomName, setNewRoomName] = useState('');
  const [roomReady, setRoomReady] = useState(false);

  const [onlineUsers, setOnlineUsers] = useState([]);
  const [viewMode, setViewMode] = useState('room'); // 'room' | 'dm'
  const [currentDmUser, setCurrentDmUser] = useState(null);

  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');

  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Kept in refs so the long-lived 'new-dm' listener (registered once) can
  // always see the latest view without needing to be torn down and
  // re-attached every time the user switches conversations.
  const viewModeRef = useRef(viewMode);
  const currentDmUserRef = useRef(currentDmUser);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);
  useEffect(() => {
    currentDmUserRef.current = currentDmUser;
  }, [currentDmUser]);

  // Connect once after joining: register our username, load the room list,
  // and listen for anything that isn't scoped to a single room/DM.
  useEffect(() => {
    if (!joined) return;

    const socket = io(SOCKET_URL);
    socketRef.current = socket;

    socket.emit('register-user', { username }, () => {
      // Only now is this socket guaranteed to be known to the server by
      // name, so direct messages sent to/from it will actually route.
      setRegistered(true);
    });

    fetch(`${SOCKET_URL}/api/rooms`)
      .then((res) => res.json())
      .then(setRooms);

    socket.on('room-created', (room) => {
      setRooms((prev) => [...prev, room]);
    });

    socket.on('users-online', (usernames) => {
      setOnlineUsers(usernames);
    });

    socket.on('new-dm', (msg) => {
      const other = msg.from_username === username ? msg.to_username : msg.from_username;
      // Only append if we're actually looking at this conversation right
      // now — otherwise it's still saved server-side and will load next
      // time this DM is opened.
      if (viewModeRef.current === 'dm' && currentDmUserRef.current === other) {
        setMessages((prev) => [...prev, { id: msg.id, username: msg.from_username, text: msg.text }]);
      }
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

  // Whenever the selected room is (re)selected: join its socket channel and
  // load its history. Re-runs on a view-mode change too, so switching back
  // to "Rooms" after viewing a DM re-syncs the room view.
  useEffect(() => {
    if (viewMode !== 'room' || !currentRoomId || !socketRef.current) return;
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
      if (message.room_id === currentRoomId && viewModeRef.current === 'room') {
        setMessages((prev) => [...prev, message]);
      }
    }

    socket.on('new-message', handleNewMessage);
    return () => {
      socket.off('new-message', handleNewMessage);
    };
  }, [currentRoomId, viewMode]);

  // Whenever a DM conversation is opened, load its history.
  useEffect(() => {
    if (viewMode !== 'dm' || !currentDmUser) return;
    fetch(`${SOCKET_URL}/api/dms?user1=${encodeURIComponent(username)}&user2=${encodeURIComponent(currentDmUser)}`)
      .then((res) => res.json())
      .then((dms) => setMessages(dms.map((m) => ({ id: m.id, username: m.from_username, text: m.text }))));
  }, [viewMode, currentDmUser]);

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

  function handleSendDm(e) {
    e.preventDefault();
    if (!messageInput.trim() || !currentDmUser) return;
    socketRef.current.emit('send-dm', {
      toUsername: currentDmUser,
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
      setViewMode('room');
      setCurrentRoomId(room.id);
    }
  }

  function handleSelectRoom(roomId) {
    setViewMode('room');
    setCurrentRoomId(roomId);
  }

  function handleOpenDm(otherUsername) {
    setViewMode('dm');
    setCurrentDmUser(otherUsername);
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
  const otherOnlineUsers = onlineUsers.filter((u) => u !== username);
  const headerTitle = viewMode === 'dm' ? currentDmUser : currentRoom ? currentRoom.name : 'Realtime Chat';
  const isComposerReady = viewMode === 'dm' ? registered : registered && roomReady;

  return (
    <div className="chat-app">
      <aside className="room-sidebar">
        <h2>Rooms</h2>
        <ul className="room-list">
          {rooms.map((room) => (
            <li key={room.id}>
              <button
                className={`room-item ${viewMode === 'room' && room.id === currentRoomId ? 'active' : ''}`}
                onClick={() => handleSelectRoom(room.id)}
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

        <h2 className="dm-section-title">Direct Messages</h2>
        {otherOnlineUsers.length === 0 ? (
          <p className="no-users-message">No one else online</p>
        ) : (
          <ul className="dm-list">
            {otherOnlineUsers.map((u) => (
              <li key={u}>
                <button
                  className={`dm-item ${viewMode === 'dm' && currentDmUser === u ? 'active' : ''}`}
                  onClick={() => handleOpenDm(u)}
                >
                  {u}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="chat-main">
        <header className="chat-header">
          <h1>{headerTitle}</h1>
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

        {isComposerReady ? (
          <form className="message-form" onSubmit={viewMode === 'dm' ? handleSendDm : handleSend}>
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
          <div className="message-form message-form-loading">
            {viewMode === 'dm' ? 'Connecting…' : 'Joining room…'}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
