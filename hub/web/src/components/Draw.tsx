// Draw.tsx — free-hand canvas per project, persisted in localStorage
import { useCallback, useEffect, useRef, useState } from 'react'
import { showToast } from '../toast'

const PRESETS = ['#ffffff', '#f87171', '#fb923c', '#facc15', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6']
const BG = '#05070e'

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6M9 6V4h6v2" />
  </svg>
)

const BrushIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
    <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1 1 2.48 1.02 3.5 1.02 1.68 0 3.05-1.36 3.05-3.04 0-1.66-1.37-3.02-3.05-3.02z" />
  </svg>
)

function Swatch({ c, active, onClick }: { c: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 20, height: 20, borderRadius: '50%',
        background: c, border: 'none', cursor: 'pointer', padding: 0,
        flexShrink: 0, transition: 'outline-color 0.1s',
        outline: active ? '2px solid #ffffff' : '2px solid transparent',
        outlineOffset: 2,
      }}
    />
  )
}

export default function Draw({ projectId }: { projectId?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [color, setColor] = useState('#60a5fa')
  const [customColor, setCustomColor] = useState('#60a5fa')
  const [brushSize, setBrushSize] = useState(4)
  const [eraser, setEraser] = useState(false)
  const drawing = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  const LKEY = `lucy_draw_${projectId ?? 'global'}`

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const saved = localStorage.getItem(LKEY)
    if (saved) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0)
      img.src = saved
    }
  }, [LKEY])

  const persist = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      localStorage.setItem(LKEY, canvas.toDataURL())
    } catch {
      showToast('Không thể lưu — bộ nhớ đầy', 'error')
    }
  }, [LKEY])

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true
    lastPos.current = getPos(e)
    canvasRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pos = getPos(e)
    const from = lastPos.current ?? pos
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = eraser ? BG : color
    ctx.lineWidth = eraser ? brushSize * 3 : brushSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    lastPos.current = pos
  }

  const onPointerUp = () => {
    if (!drawing.current) return
    drawing.current = false
    lastPos.current = null
    persist()
  }

  const clear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    persist()
  }

  const isCustomActive = !eraser && !PRESETS.includes(color)

  return (
    <div id="tab-draw" className="h-full flex flex-col overflow-hidden" style={{ background: BG }}>
      {/* ── controls bar ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10, flexShrink: 0,
        height: 52, padding: '0 12px',
        background: 'rgba(11,19,34,0.97)',
        borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 8,
        overflow: 'hidden',
      }}>
        {/* preset swatches */}
        {PRESETS.map((c) => (
          <Swatch key={c} c={c} active={!eraser && color === c} onClick={() => { setColor(c); setEraser(false) }} />
        ))}

        {/* custom color picker */}
        <div style={{ position: 'relative', width: 20, height: 20, flexShrink: 0 }}>
          <div style={{
            width: 20, height: 20, borderRadius: '50%',
            background: PRESETS.includes(customColor)
              ? 'conic-gradient(red,yellow,lime,aqua,blue,magenta,red)'
              : customColor,
            outline: isCustomActive ? '2px solid #ffffff' : '2px solid rgba(255,255,255,0.25)',
            outlineOffset: 2,
            overflow: 'hidden',
          }}>
            <input
              type="color"
              value={customColor}
              onChange={(e) => { setCustomColor(e.target.value); setColor(e.target.value); setEraser(false) }}
              style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }}
            />
          </div>
        </div>

        <div style={{ width: 1, height: 24, background: 'var(--line)', flexShrink: 0 }} />

        {/* brush size */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, color: '#9fb4c9' }}>
          <BrushIcon />
          <input
            type="range" min={1} max={32} value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            style={{ width: 80, accentColor: '#3fd3ff', cursor: 'pointer' }}
          />
        </div>

        <div style={{ width: 1, height: 24, background: 'var(--line)', flexShrink: 0 }} />

        {/* eraser */}
        <button
          className="btn"
          onClick={() => setEraser((v) => !v)}
          style={{
            padding: '3px 10px', fontSize: 12, height: 28, flexShrink: 0,
            ...(eraser ? { background: 'rgba(56,208,255,0.14)', borderColor: '#3fd3ff', color: '#3fd3ff' } : {}),
          }}
        >
          ◻ Tẩy
        </button>

        {/* clear */}
        <button
          className="btn"
          onClick={clear}
          style={{ padding: '3px 10px', fontSize: 12, height: 28, flexShrink: 0, color: '#f87171', borderColor: 'rgba(248,113,113,0.35)' }}
        >
          <TrashIcon /> Xóa
        </button>
      </div>

      {/* ── canvas ── */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          width={1200}
          height={800}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            display: 'block',
            borderRadius: 8,
            cursor: eraser ? 'default' : 'crosshair',
            touchAction: 'none',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>
    </div>
  )
}
