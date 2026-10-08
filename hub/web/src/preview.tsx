// Trang preview độc lập: render thẳng BrainViz, KHÔNG qua login.
// Mở http://localhost:5173/preview.html — telemetry fail -> mock fallback -> vẫn xem được.
import { createRoot } from 'react-dom/client'
import BrainViz from './components/BrainViz'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <div style={{ position: 'fixed', inset: 0, background: '#05070e' }}>
    <BrainViz visible={true} />
  </div>,
)
