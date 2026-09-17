import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SOCKET_URL = 'http://localhost:3004';
const STORAGE_KEY = 'chatAuth';

function App() {
  // ---- Auth ----
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [token, setToken] = useState(null);
  const [authMode, setAuthMode] = useState('signup'); // 'signup' | 'login'
  const [authUsernameInput, setAuthUsernameInput] = useState('');
  const [authPasswordInput, setAuthPasswordInput] = useState('');
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [socketConnected, setSocketConnected] = useState(false);

  const [rooms, setRooms] = useState([]);
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [newRoomName, setNewRoomName] = useState('');
  const [roomReady, setRoomReady] = useState(false);

  const [onlineUsers, setOnlineUsers] = useState([]);
  const [viewMode, setViewMode] = useState('room'); // 'room' | 'dm'
  const [currentDmUser, setCurrentDmUser] = useState(null);

  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');

  const [typingUsers, setTypingUsers] = useState([]); // usernames typing in the current room
  const [dmTypingUser, setDmTypingUser] = useState(false); // is currentDmUser typing to me

  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingStopTimerRef = useRef(null);

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

  // Restore a previous session on load, so refreshing the page doesn't
  // force the user to log in again.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.token && parsed?.username) {
          setToken(parsed.token);
          setUsername(parsed.username);
          setAuthenticated(true);
        }
      }
    } catch (err) {
      // Corrupted or unreadable localStorage — just show the login screen.
    }
  }, []);

  function authHeaders() {
    return { Authorization: `Bearer ${token}` };
  }

  function handleAuthSuccess(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: data.token, username: data.username }));
    setToken(data.token);
    setUsername(data.username);
    setAuthenticated(true);
    setAuthError(null);
    setAuthPasswordInput('');
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    setAuthError(null);

    const usernameValue = authUsernameInput.trim();
    const passwordValue = authPasswordInput;

    if (usernameValue.length < 3) {
      setAuthError('Username must be at least 3 characters');
      return;
    }
    if (passwordValue.length < 6) {
      setAuthError('Password must be at least 6 characters');
      return;
    }

    setAuthLoading(true);
    try {
      const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const res = await fetch(`${SOCKET_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameValue, password: passwordValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Something went wrong');
        return;
      }
      handleAuthSuccess(data);
    } catch (err) {
      setAuthError('Could not reach the server. Is it running?');
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    socketRef.current?.disconnect();
    localStorage.removeItem(STORAGE_KEY);
    setAuthenticated(false);
    setToken(null);
    setUsername('');
    setSocketConnected(false);
    setRooms([]);
    setCurrentRoomId(null);
    setRoomReady(false);
    setOnlineUsers([]);
    setViewMode('room');
    setCurrentDmUser(null);
    setMessages([]);
    setTypingUsers([]);
    setDmTypingUser(false);
    clearTimeout(typingStopTimerRef.current);
    setAuthMode('signup');
    setAuthUsernameInput('');
    setAuthPasswordInput('');
  }

  // Connect once we're authenticated: the JWT proves who we are, so there's
  // no separate "register my name" step — the server already knows.
  useEffect(() => {
    if (!authenticated || !token) return;

    const socket = io(SOCKET_URL, { auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => setSocketConnected(true));
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('connect_error', () => {
      // The token was rejected (expired, tampered, or the server restarted
      // with a different secret) — the session is no longer valid.
      localStorage.removeItem(STORAGE_KEY);
      setAuthenticated(false);
      setToken(null);
      setUsername('');
      setAuthError('Your session expired. Please log in again.');
    });

    fetch(`${SOCKET_URL}/api/rooms`, { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load rooms'))))
      .then(setRooms)
      .catch(() => {
        // A rejected session shows up here too (not just via the socket) —
        // 'connect_error' above is what actually drives the user back to
        // the login screen, this just avoids crashing on a non-array
        // response in the meantime.
      });

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
  }, [authenticated, token]);

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
    setTypingUsers([]);
    socket.emit('join-room', { roomId: currentRoomId }, () => {
      // Only now is this socket guaranteed to be registered server-side to
      // receive broadcasts for this room.
      setRoomReady(true);
    });

    fetch(`${SOCKET_URL}/api/messages?roomId=${currentRoomId}`, { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load messages'))))
      .then(setMessages)
      .catch(() => {});

    function handleNewMessage(message) {
      if (message.room_id === currentRoomId && viewModeRef.current === 'room') {
        setMessages((prev) => [...prev, message]);
      }
    }
    socket.on('new-message', handleNewMessage);

    // Per-user auto-clear timers: a safety net so a typing indicator can
    // never get stuck forever if an explicit "stopped typing" event is
    // ever lost (e.g. a flaky connection).
    const typingTimers = {};
    function handleUserTyping({ roomId: eventRoomId, username: typingUsername, isTyping }) {
      if (eventRoomId !== currentRoomId) return;
      setTypingUsers((prev) => {
        if (isTyping) {
          return prev.includes(typingUsername) ? prev : [...prev, typingUsername];
        }
        return prev.filter((u) => u !== typingUsername);
      });
      clearTimeout(typingTimers[typingUsername]);
      if (isTyping) {
        typingTimers[typingUsername] = setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u !== typingUsername));
        }, 3000);
      }
    }
    socket.on('user-typing', handleUserTyping);

    return () => {
      socket.off('new-message', handleNewMessage);
      socket.off('user-typing', handleUserTyping);
      Object.values(typingTimers).forEach(clearTimeout);
    };
  }, [currentRoomId, viewMode, token]);

  // Whenever a DM conversation is opened, load its history.
  useEffect(() => {
    if (viewMode !== 'dm' || !currentDmUser || !socketRef.current) return;
    const socket = socketRef.current;
    setDmTypingUser(false);

    fetch(`${SOCKET_URL}/api/dms?user1=${encodeURIComponent(username)}&user2=${encodeURIComponent(currentDmUser)}`, {
      headers: authHeaders(),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load DM history'))))
      .then((dms) => setMessages(dms.map((m) => ({ id: m.id, username: m.from_username, text: m.text }))))
      .catch(() => {});

    let dmTypingTimer = null;
    function handleDmTyping({ fromUsername, isTyping }) {
      if (fromUsername !== currentDmUser) return;
      setDmTypingUser(isTyping);
      clearTimeout(dmTypingTimer);
      if (isTyping) {
        dmTypingTimer = setTimeout(() => setDmTypingUser(false), 3000);
      }
    }
    socket.on('user-typing-dm', handleDmTyping);

    return () => {
      socket.off('user-typing-dm', handleDmTyping);
      clearTimeout(dmTypingTimer);
    };
  }, [viewMode, currentDmUser, token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend(e) {
    e.preventDefault();
    if (!messageInput.trim() || !currentRoomId) return;
    clearTimeout(typingStopTimerRef.current);
    socketRef.current.emit('typing', { roomId: currentRoomId, isTyping: false });
    socketRef.current.emit('send-message', {
      roomId: currentRoomId,
      text: messageInput,
    });
    setMessageInput('');
  }

  function handleSendDm(e) {
    e.preventDefault();
    if (!messageInput.trim() || !currentDmUser) return;
    clearTimeout(typingStopTimerRef.current);
    socketRef.current.emit('typing-dm', { toUsername: currentDmUser, isTyping: false });
    socketRef.current.emit('send-dm', {
      toUsername: currentDmUser,
      text: messageInput,
    });
    setMessageInput('');
  }

  // Tells the other side(s) "I'm typing", then automatically tells them
  // "I stopped" after a short pause with no further keystrokes.
  function handleMessageInputChange(e) {
    const value = e.target.value;
    setMessageInput(value);

    const socket = socketRef.current;
    if (!socket) return;

    clearTimeout(typingStopTimerRef.current);
    if (viewMode === 'room' && currentRoomId) {
      socket.emit('typing', { roomId: currentRoomId, isTyping: true });
      typingStopTimerRef.current = setTimeout(() => {
        socket.emit('typing', { roomId: currentRoomId, isTyping: false });
      }, 1500);
    } else if (viewMode === 'dm' && currentDmUser) {
      socket.emit('typing-dm', { toUsername: currentDmUser, isTyping: true });
      typingStopTimerRef.current = setTimeout(() => {
        socket.emit('typing-dm', { toUsername: currentDmUser, isTyping: false });
      }, 1500);
    }
  }

  async function handleCreateRoom(e) {
    e.preventDefault();
    const name = newRoomName.trim();
    if (!name) return;

    const res = await fetch(`${SOCKET_URL}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
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

  if (!authenticated) {
    return (
      <div className="join-screen">
        <form className="auth-form" onSubmit={handleAuthSubmit}>
          <h1>Realtime Chat</h1>
          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab ${authMode === 'signup' ? 'active' : ''}`}
              onClick={() => {
                setAuthMode('signup');
                setAuthError(null);
              }}
            >
              Sign Up
            </button>
            <button
              type="button"
              className={`auth-tab ${authMode === 'login' ? 'active' : ''}`}
              onClick={() => {
                setAuthMode('login');
                setAuthError(null);
              }}
            >
              Log In
            </button>
          </div>
          <input
            type="text"
            name="username"
            placeholder="Username"
            value={authUsernameInput}
            onChange={(e) => setAuthUsernameInput(e.target.value)}
            autoFocus
          />
          <input
            type="password"
            name="password"
            placeholder="Password"
            value={authPasswordInput}
            onChange={(e) => setAuthPasswordInput(e.target.value)}
          />
          {authError && <p className="auth-error">{authError}</p>}
          <button type="submit" disabled={authLoading}>
            {authLoading ? 'Please wait…' : authMode === 'signup' ? 'Create Account' : 'Log In'}
          </button>
        </form>
      </div>
    );
  }

  const currentRoom = rooms.find((r) => r.id === currentRoomId);
  const otherOnlineUsers = onlineUsers.filter((u) => u !== username);
  const headerTitle = viewMode === 'dm' ? currentDmUser : currentRoom ? currentRoom.name : 'Realtime Chat';
  const isComposerReady = viewMode === 'dm' ? socketConnected : socketConnected && roomReady;

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
          <span className="current-user">
            Logged in as {username}
            <button className="logout-button" onClick={handleLogout}>
              Log Out
            </button>
          </span>
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

        {viewMode === 'room' && typingUsers.length > 0 && (
          <div className="typing-indicator">
            {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing…
          </div>
        )}
        {viewMode === 'dm' && dmTypingUser && (
          <div className="typing-indicator">{currentDmUser} is typing…</div>
        )}

        {isComposerReady ? (
          <form className="message-form" onSubmit={viewMode === 'dm' ? handleSendDm : handleSend}>
            <input
              type="text"
              placeholder="Type a message..."
              value={messageInput}
              onChange={handleMessageInputChange}
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
