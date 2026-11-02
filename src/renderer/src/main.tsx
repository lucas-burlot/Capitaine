import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'

// Drops are handled by terminals only; anywhere else they must not open the file in the window.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(<App />)
