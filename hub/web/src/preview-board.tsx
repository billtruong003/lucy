// Preview Board + Channels (KHÔNG cần login). Cần seed coordinator chạy: agent-machine `npm run seed`.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import Board from './components/Board'
import Channels from './components/Channels'
import './index.css'

function Preview() {
  const [tab, setTab] = useState<'board' | 'channels'>('board')
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#05070e', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid rgba(127,179,214,0.14)' }}>
        {(['board', 'channels'] as const).map((t) => (
          <button key={t} className={'btn ' + (tab === t ? 'btn-primary' : '')} onClick={() => setTab(t)}>
            {t === 'board' ? '📋 Board' : '📡 Channels'}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', alignSelf: 'center', color: '#5e748b', fontSize: 12 }}>preview · seed coordinator :8780</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>{tab === 'board' ? <Board /> : <Channels />}</div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Preview />)
