import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [healthMessage, setHealthMessage] = useState('Checking API health...')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: { status: string }) => setHealthMessage(`API status: ${data.status}`))
      .catch(() => setHealthMessage('Could not reach the API — is the server running?'))
  }, [])

  return (
    <section id="center">
      <h1>Helpdesks</h1>
      <p>{healthMessage}</p>
    </section>
  )
}

export default App
