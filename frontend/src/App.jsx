import './App.css'

function App() {
  return (
    <main className="hero-section">
      <section className="hero-content" aria-labelledby="hero-title">
        <h1 id="hero-title">Talk in the moment</h1>
        <p className="hero-description">
          Create a room, share its short code, and chat without accounts or
          message history.
        </p>

        <div className="room-card">
          <form
            className="room-form"
            onSubmit={(event) => event.preventDefault()}
          >
            <label htmlFor="display-name">Display name</label>
            <div className="room-form-row">
              <input
                id="display-name"
                name="displayName"
                type="text"
                placeholder="Enter your name"
              />
              <button type="submit">Create a room</button>
            </div>
          </form>

          <div className="room-divider" aria-hidden="true">
            <span>or join one</span>
          </div>

          <form
            className="room-form"
            onSubmit={(event) => event.preventDefault()}
          >
            <label htmlFor="room-code">Room code</label>
            <div className="room-form-row">
              <input
                id="room-code"
                name="roomCode"
                type="text"
                placeholder="Enter room code"
              />
              <button type="submit">Join room</button>
            </div>
          </form>
        </div>
      </section>
    </main>
  )
}

export default App
