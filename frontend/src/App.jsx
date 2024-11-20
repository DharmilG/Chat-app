import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import io from 'socket.io-client'
import './App.css'

const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000'

function getRoomCode() {
  const match = window.location.pathname.match(/^\/room\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

function navigateToRoom(roomCode) {
  window.history.pushState({}, '', `/room/${encodeURIComponent(roomCode)}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function LandingPage() {
  const [displayName, setDisplayName] = useState('')
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
    <main className="hero-section">
      <section className="hero-content" aria-labelledby="hero-title">
        <h1 id="hero-title">Talk in the moment</h1>
        <p className="hero-description">
          Create a room, share its short code, and chat without accounts or
          message history.
        </p>

        <div className="room-card">
          <form className="room-form" onSubmit={createRoom}>
            <label htmlFor="display-name">Display name</label>
            <div className="room-form-row">
              <input
                id="display-name"
                name="displayName"
                type="text"
                placeholder="Enter your name"
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  setError('')
                }}
              />
              <button type="submit">Create a room</button>
            </div>
          </form>

          <div className="room-divider" aria-hidden="true">
            <span>or join one</span>
          </div>

          <form className="room-form" onSubmit={joinRoom}>
            <label htmlFor="room-code">Room code</label>
            <div className="room-form-row">
              <input
                id="room-code"
                name="roomCode"
                type="text"
                placeholder="Enter room code"
                value={roomCode}
                onChange={(event) => {
                  setRoomCode(event.target.value)
                  setError('')
                }}
              />
              <button type="submit">Join room</button>
            </div>
          </form>

          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      </section>
    </main>
  )
}

function ChatRoom({ roomCode }) {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([])
  const socketRef = useRef(null)
  const [socketId, setSocketId] = useState(null)
  const [displayName] = useState(
    () => sessionStorage.getItem('chatDisplayName') || 'Guest',
  )

  useEffect(() => {
    const socket = io(socketUrl)
    socketRef.current = socket
    socket.on('connect', () => {
      setSocketId(socket.id)
      socket.emit('join-room', { roomCode, displayName })
    })
    socket.on('chat-message', (chatMessage) => {
      setMessages((currentMessages) => [...currentMessages, chatMessage])
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
      setSocketId(null)
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
      setMessages((currentMessages) => [...currentMessages, chatMessage])
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
                  chatMessage.senderId === socketId
                    ? 'message-own'
                    : ''
                }`}
                key={`${chatMessage.timestamp}-${index}`}
              >
                <strong>
                  {chatMessage.senderId === socketId
                    ? 'You'
                    : chatMessage.displayName}
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

  useEffect(() => {
    const handleNavigation = () => setRoomCode(getRoomCode())
    window.addEventListener('popstate', handleNavigation)
    return () => window.removeEventListener('popstate', handleNavigation)
  }, [])

  return roomCode ? <ChatRoom roomCode={roomCode} /> : <LandingPage />
}

export default App
