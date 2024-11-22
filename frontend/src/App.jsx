import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import io from 'socket.io-client'
import './App.css'
import ThemeToggle from './components/ThemeToggle'

const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000'

function getRoomCode() {
  const match = window.location.pathname.match(/^\/room\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

function navigateToRoom(roomCode) {
  window.history.pushState({}, '', `/room/${encodeURIComponent(roomCode)}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function LandingPage({ theme, onToggleTheme }) {
  const [displayName, setDisplayName] = useState(
    () => sessionStorage.getItem('chatDisplayName') || '',
  )
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState('')

  function createRoom(event) {
    event.preventDefault()
    const name = displayName.trim()

    if (!name) {
      setError('Enter a display name to create a room.')
      return
    }

    sessionStorage.setItem('chatDisplayName', name)
    navigateToRoom(nanoid(6).toUpperCase())
  }

  function joinRoom(event) {
    event.preventDefault()
    const name = displayName.trim()
    const code = roomCode.trim().toUpperCase()

    if (!name || !code) {
      setError('Enter your display name and a room code to join.')
      return
    }

    sessionStorage.setItem('chatDisplayName', name)
    navigateToRoom(code)
  }

  return (
    <main className="home-page">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">T</span>
          <div>
            <strong>Talk in the moment</strong>
            <span>Private conversations, nothing permanent.</span>
          </div>
        </div>
        <div className="header-actions">
          <span className="availability">
            <span className="status-dot" aria-hidden="true" />
            Ready to connect
          </span>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button className="icon-button" type="button" disabled>
            Settings
          </button>
        </div>
      </header>

      <section className="home-intro" aria-labelledby="hero-title">
        <p className="hero-eyebrow">No accounts. No history.</p>
        <h1 id="hero-title">Talk in the moment</h1>
        <p className="hero-description">
          Connect privately, share only what matters, and leave nothing
          behind when the conversation ends.
        </p>
      </section>

      <section className="identity-card" aria-labelledby="identity-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Your temporary identity</p>
            <h2 id="identity-title">How should people see you?</h2>
          </div>
          <span className="identity-badge">Session only</span>
        </div>
        <div className="identity-form-row">
          <label className="sr-only" htmlFor="display-name">Display name</label>
          <input
            id="display-name"
            name="displayName"
            type="text"
            placeholder="Enter a display name"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value)
              setError('')
            }}
          />
          <span className="identity-preview">
            {displayName.trim() ? displayName.trim().charAt(0).toUpperCase() : '?'}
          </span>
        </div>
        <p className="helper-text">
          This name is used only for the current chat session. There is no
          account to create.
        </p>
      </section>

      <section className="action-grid" aria-label="Connection options">
        <article className="action-card action-card-primary">
          <div className="action-icon" aria-hidden="true">↗</div>
          <p className="section-kicker">Private conversation</p>
          <h2>Start a new private chat</h2>
          <p>
            Find someone who is currently available and start a direct
            conversation.
          </p>
          <button className="primary-action" type="button" disabled>
            New private chat
          </button>
          <span className="availability-note">User discovery is coming next</span>
        </article>

        <article className="action-card">
          <div className="action-icon" aria-hidden="true">⌁</div>
          <p className="section-kicker">Local network</p>
          <h2>Connect nearby</h2>
          <p>
            Local peer discovery will let people on the same network connect
            directly.
          </p>
          <div className="unavailable-state">
            <span className="status-dot status-dot-muted" aria-hidden="true" />
            <span>Local discovery is not available yet</span>
          </div>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="dashboard-card">
          <div className="section-heading">
            <div>
              <p className="section-kicker">People nearby</p>
              <h2>Online users</h2>
            </div>
            <span className="count-badge">0 online</span>
          </div>
          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden="true">○</div>
            <strong>No one is available right now</strong>
            <p>Online users will appear here when discovery is connected.</p>
          </div>
        </article>

        <article className="dashboard-card join-card">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Have an invitation?</p>
              <h2>Join an existing room</h2>
            </div>
          </div>
          <form className="room-form" onSubmit={joinRoom}>
            <label htmlFor="room-code">Room code</label>
            <div className="room-form-row">
              <input
                id="room-code"
                name="roomCode"
                type="text"
                placeholder="Enter short code"
                value={roomCode}
                onChange={(event) => {
                  setRoomCode(event.target.value)
                  setError('')
                }}
              />
              <button type="submit">Join room</button>
            </div>
          </form>
          <button className="text-button" type="button" onClick={createRoom}>
            Create a new room instead
          </button>
          <p className="helper-text">Room messages are live and are not saved.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
        </article>
      </section>
    </main>
  )
}

function ChatRoom({ roomCode }) {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([])
  const socketRef = useRef(null)
  const [displayName] = useState(
    () => sessionStorage.getItem('chatDisplayName') || 'Guest',
  )

  useEffect(() => {
    const socket = io(socketUrl)
    socketRef.current = socket
    socket.on('connect', () => {
      socket.emit('join-room', { roomCode, displayName })
    })
    socket.on('chat-message', (chatMessage) => {
      setMessages((currentMessages) => [...currentMessages, chatMessage])
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [displayName, roomCode])

  function sendMessage(event) {
    event.preventDefault()
    const text = message.trim()
    if (!text) return

    if (!socketRef.current?.connected) return

    socketRef.current.emit('chat-message', {
      roomCode,
      displayName,
      message: text,
    }, (chatMessage) => {
      setMessages((currentMessages) => [
        ...currentMessages,
        { ...chatMessage, isOwn: true },
      ])
    })
    setMessage('')
  }

  return (
    <main className="chat-section">
      <section className="chat-panel" aria-labelledby="room-title">
        <div className="chat-header">
          <div>
            <p className="hero-eyebrow">Live room</p>
            <h1 id="room-title">Room {roomCode}</h1>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              window.history.pushState({}, '', '/')
              window.dispatchEvent(new PopStateEvent('popstate'))
            }}
          >
            Leave room
          </button>
        </div>

        <div className="messages" aria-live="polite">
          {messages.length === 0 ? (
            <p className="empty-messages">No messages yet. Start the conversation.</p>
          ) : (
            messages.map((chatMessage, index) => (
              <article
                className={`message ${
                  chatMessage.isOwn ? 'message-own' : ''
                }`}
                key={`${chatMessage.timestamp}-${index}`}
              >
                <strong>
                  {chatMessage.isOwn ? 'You' : chatMessage.displayName}
                </strong>
                <p>{chatMessage.message}</p>
              </article>
            ))
          )}
        </div>

        <form className="message-form" onSubmit={sendMessage}>
          <input
            aria-label="Message"
            type="text"
            placeholder="Write a message..."
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <button type="submit">Send</button>
        </form>
      </section>
    </main>
  )
}

function App() {
  const [roomCode, setRoomCode] = useState(getRoomCode)
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('chat-theme')
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  })

  useEffect(() => {
    const handleNavigation = () => setRoomCode(getRoomCode())
    window.addEventListener('popstate', handleNavigation)
    return () => window.removeEventListener('popstate', handleNavigation)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('chat-theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark')
  }

  return roomCode
    ? <ChatRoom roomCode={roomCode} />
    : <LandingPage theme={theme} onToggleTheme={toggleTheme} />
}

export default App
