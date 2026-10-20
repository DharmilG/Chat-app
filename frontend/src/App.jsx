import { useState, useEffect } from 'react'
import io from "socket.io-client"
import "nanoid"


const socket = io("http://localhost:3000") 

const [message, useMessage] = useState('')
const [chat, setChat] = useState([])
function App() {
  return(
    <div className="App">
      <h1>Chat App</h1>
      <form>
        <input type='text' placeholder='send teh message here'></input>
      </form>
    </div>

  )
}

export default App
