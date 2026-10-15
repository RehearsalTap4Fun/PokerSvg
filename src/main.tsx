import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initLayout } from './ui/layout'
import { setupPWA } from './pwa'
import './styles.css'

initLayout()
setupPWA()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
