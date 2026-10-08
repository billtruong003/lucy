import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initFx } from './fx'

initFx()  // S1/U0: áp "reduce effects" trước render (tránh nháy)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
