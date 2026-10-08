// Mindmap.tsx — SVG mindmap editor (per-project, persisted in localStorage)
// Nodes: foreignObject div — CSS border/shadow/radius. Edges: SVG path, pointer-events none on visible.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { showToast } from '../toast'

const CYAN    = '#3fd3ff'
const PINK    = '#ff5d9e'
const LINE    = 'rgba(127,179,214,0.14)'
const INKFAINT = '#5e748b'
const SURFACE2 = '#111c30'
const ACCENT   = '#3fd3ff'
const DANGER   = '#ff5d9e'

const NODE_W = 160
const NODE_H = 44
const PORT_R = 5

const PALETTE = {
  cyan:  { fill: 'rgba(56,208,255,0.10)',  stroke: '#3fd3ff', text: '#3fd3ff' },
  grn:   { fill: 'rgba(95,227,154,0.10)',  stroke: '#5fe39a', text: '#5fe39a' },
  pink:  { fill: 'rgba(255,93,158,0.10)',  stroke: '#ff5d9e', text: '#ff5d9e' },
  amber: { fill: 'rgba(255,157,92,0.10)',  stroke: '#ff9d5c', text: '#ff9d5c' },
  dim:   { fill: 'rgba(17,28,48,0.85)',    stroke: 'rgba(127,179,214,0.28)', text: '#cfe0ef' },
} as const
type CK = keyof typeof PALETTE
const PALETTE_KEYS = Object.keys(PALETTE) as CK[]

type MNode = { id: string; label: string; x: number; y: number; color: CK }
type MEdge = { id: string; from: string; to: string }
type MM    = { nodes: MNode[]; edges: MEdge[] }

const EMPTY: MM = { nodes: [], edges: [] }

let _seq = 0
const uid = () => `${++_seq}_${Math.random().toString(36).slice(2, 5)}`
const LKEY = (pid: string) => 'lucy_mm_' + pid
function loadMM(pid: string): MM { try { return JSON.parse(localStorage.getItem(LKEY(pid)) || '') as MM } catch { return EMPTY } }
function saveMM(pid: string, m: MM) { try { localStorage.setItem(LKEY(pid), JSON.stringify(m)) } catch { showToast('Không thể lưu — bộ nhớ đầy', 'error') } }

type DragInfo =
  | { type: 'node'; id: string; offX: number; offY: number }
  | { type: 'pan';  sx: number; sy: number; px: number; py: number }

function IconPlus() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
    </svg>
  )
}

export default function Mindmap({ projectId }: { projectId: string }) {
  const [mm, setMm]             = useState<MM>(() => loadMM(projectId))
  const [pan, setPan]           = useState({ x: 64, y: 64 })
  const [hNode, setHNode]       = useState<string | null>(null)
  const [hEdge, setHEdge]       = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing]   = useState<{ id: string; label: string } | null>(null)
  const [connecting, setConnecting] = useState<{ fromId: string; mx: number; my: number } | null>(null)

  const svgRef  = useRef<SVGSVGElement>(null)
  const drag    = useRef<DragInfo | null>(null)
  const connRef = useRef<{ fromId: string } | null>(null)
  const mmRef   = useRef(mm)
  const panRef  = useRef(pan)

  useLayoutEffect(() => { mmRef.current = mm }, [mm])
  useEffect(() => { panRef.current = pan }, [pan])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (connRef.current) { connRef.current = null; setConnecting(null) }
      else setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const commit = (next: MM) => { setMm(next); saveMM(projectId, next) }

  const addNode = () => {
    const i = mmRef.current.nodes.length
    commit({
      ...mmRef.current,
      nodes: [...mmRef.current.nodes, {
        id: uid(), label: 'Node',
        x: 60 + (i * 190) % 540,
        y: 60 + (i * 100) % 320,
        color: PALETTE_KEYS[i % PALETTE_KEYS.length],
      }],
    })
  }

  const deleteNode = (id: string) => {
    commit({
      nodes: mmRef.current.nodes.filter((n) => n.id !== id),
      edges: mmRef.current.edges.filter((e) => e.from !== id && e.to !== id),
    })
    if (hNode === id) setHNode(null)
    if (selectedId === id) setSelectedId(null)
  }

  const deleteSelected = () => { if (selectedId) deleteNode(selectedId) }

  const deleteEdge = (id: string) => commit({ ...mmRef.current, edges: mmRef.current.edges.filter((e) => e.id !== id) })

  const toWorld = (cx: number, cy: number) => {
    const svg = svgRef.current; if (!svg) return { x: cx, y: cy }
    const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy
    const m = svg.getScreenCTM(); if (!m) return { x: cx, y: cy }
    const w = pt.matrixTransform(m.inverse())
    return { x: w.x - panRef.current.x, y: w.y - panRef.current.y }
  }

  const onPtrMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (d?.type === 'node') {
      const wp = toWorld(e.clientX, e.clientY)
      setMm((prev) => ({ ...prev, nodes: prev.nodes.map((n) => n.id === d.id ? { ...n, x: wp.x - d.offX, y: wp.y - d.offY } : n) }))
    } else if (d?.type === 'pan') {
      setPan({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) })
    }
    if (connRef.current) {
      const wp = toWorld(e.clientX, e.clientY)
      setConnecting((c) => c ? { ...c, mx: wp.x, my: wp.y } : c)
    }
  }

  const onPtrUp = () => {
    if (drag.current?.type === 'node') saveMM(projectId, mmRef.current)
    drag.current = null
  }

  const onBgPtrDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = e.target as Element
    if (el !== svgRef.current && !el.classList.contains('mm-bg')) return
    setSelectedId(null)
    if (connRef.current) { connRef.current = null; setConnecting(null); return }
    drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, px: panRef.current.x, py: panRef.current.y }
  }

  const onNodePtrDown = (e: React.PointerEvent, id: string, nx: number, ny: number) => {
    e.stopPropagation()
    setSelectedId(id)
    if (connRef.current) {
      // complete connection: any click on a node while in connect mode
      const from = connRef.current.fromId
      if (from !== id && !mmRef.current.edges.some((ed) => ed.from === from && ed.to === id))
        commit({ ...mmRef.current, edges: [...mmRef.current.edges, { id: uid(), from, to: id }] })
      connRef.current = null; setConnecting(null); return
    }
    if (e.shiftKey) {
      // Shift+click = start connect mode (avoids conflict with × delete button)
      connRef.current = { fromId: id }
      const wp = toWorld(e.clientX, e.clientY)
      setConnecting({ fromId: id, mx: wp.x, my: wp.y })
      return
    }
    svgRef.current?.setPointerCapture(e.pointerId)
    const wp = toWorld(e.clientX, e.clientY)
    drag.current = { type: 'node', id, offX: wp.x - nx, offY: wp.y - ny }
  }

  const portCenter = (n: MNode) => ({ x: n.x + NODE_W, y: n.y + NODE_H / 2 })

  const bezier = (f: MNode, t: MNode) => {
    const s = portCenter(f)
    const ep = { x: t.x, y: t.y + NODE_H / 2 }
    const mx = (s.x + ep.x) / 2
    return `M${s.x},${s.y} C${mx},${s.y} ${mx},${ep.y} ${ep.x},${ep.y}`
  }

  const finishEdit = () => {
    if (!editing) return
    const { id, label } = editing
    commit({ ...mmRef.current, nodes: mmRef.current.nodes.map((n) => n.id === id ? { ...n, label: label.trim() || 'Node' } : n) })
    setEditing(null)
  }

  return (
    <div className="h-full flex flex-col" style={{ background: '#05070e', position: 'relative' }}>
      {/* ── toolbar ── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: `1px solid ${LINE}` }}>
        <span className="display text-[11px] tracking-[0.18em]" style={{ color: INKFAINT }}>MINDMAP</span>

        {/* Add Node — accent outline */}
        <button className="btn" style={{ color: ACCENT, borderColor: 'rgba(56,208,255,0.4)', gap: 5 }} onClick={addNode}>
          <IconPlus /> Node
        </button>

        {/* Delete Selected — danger, visible only when a node is selected */}
        {selectedId && (
          <button className="btn" style={{ color: DANGER, borderColor: 'rgba(255,93,158,0.4)', gap: 5 }} onClick={deleteSelected}>
            <IconTrash /> Delete
          </button>
        )}

        {connecting && (
          <>
            <span className="text-[11px] animate-pulse" style={{ color: CYAN }}>● click node đích để nối (Esc huỷ)</span>
            <button className="btn !py-1 !text-[11px]" onClick={() => { connRef.current = null; setConnecting(null) }}>Huỷ</button>
          </>
        )}

        {!connecting && mm.nodes.length > 0 && (
          <button className="btn !py-1 !text-[11px] ml-auto"
            style={{ color: '#ff8ab8', borderColor: 'rgba(255,93,158,0.3)' }}
            onClick={() => { if (confirm('Xóa toàn bộ mindmap?')) { commit(EMPTY); setSelectedId(null) } }}>
            🗑 Xóa hết
          </button>
        )}
      </div>

      {/* ── SVG canvas ── */}
      <svg ref={svgRef} className="flex-1 w-full"
        style={{ touchAction: 'none', cursor: connecting ? 'crosshair' : 'default' }}
        onPointerMove={onPtrMove}
        onPointerUp={onPtrUp}
        onPointerLeave={onPtrUp}
        onPointerDown={onBgPtrDown}
      >
        <defs>
          <pattern id="mm-dot" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.9" fill="rgba(127,179,214,0.12)" />
          </pattern>
          <marker id="mm-arr" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
            <polygon points="0,0 7,3.5 0,7" fill="rgba(127,179,214,0.40)" />
          </marker>
          <marker id="mm-arr-hov" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
            <polygon points="0,0 7,3.5 0,7" fill={PINK} />
          </marker>
        </defs>

        <rect width="100%" height="100%" fill="url(#mm-dot)" className="mm-bg" style={{ cursor: 'grab' }} />

        <g transform={`translate(${pan.x},${pan.y})`}>
          {/* ── edges — visible path has pointer-events none, hit area handles interaction ── */}
          {mm.edges.map((e) => {
            const fn = mm.nodes.find((n) => n.id === e.from)
            const tn = mm.nodes.find((n) => n.id === e.to)
            if (!fn || !tn) return null
            const ih = hEdge === e.id
            const sp = portCenter(fn)
            const ep = { x: tn.x, y: tn.y + NODE_H / 2 }
            const mp = { x: (sp.x + ep.x) / 2, y: (sp.y + ep.y) / 2 }
            const d = bezier(fn, tn)
            return (
              <g key={e.id}>
                {/* transparent hit area — 14px wide, handles hover + click */}
                <path d={d} fill="none" stroke="transparent" strokeWidth="14"
                  style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                  onPointerEnter={() => setHEdge(e.id)}
                  onPointerLeave={() => setHEdge(null)}
                  onClick={() => deleteEdge(e.id)} />
                {/* visible edge — no pointer events */}
                <path d={d} fill="none"
                  stroke={ih ? PINK : LINE}
                  strokeWidth={ih ? 1.8 : 1.5}
                  opacity={ih ? 1 : 0.7}
                  markerEnd={ih ? 'url(#mm-arr-hov)' : 'url(#mm-arr)'}
                  style={{ pointerEvents: 'none', transition: 'stroke 0.12s, stroke-width 0.12s' }} />
                {/* midpoint delete button on hover */}
                {ih && (
                  <g style={{ cursor: 'pointer' }}
                    onClick={() => deleteEdge(e.id)}
                    onPointerEnter={() => setHEdge(e.id)}>
                    <circle cx={mp.x} cy={mp.y} r="9" fill="rgba(255,93,158,0.15)" stroke="rgba(255,93,158,0.5)" />
                    <text x={mp.x} y={mp.y} textAnchor="middle" dominantBaseline="central"
                      fontSize="12" fill={PINK} style={{ pointerEvents: 'none', fontFamily: 'Inter, sans-serif' }}>×</text>
                  </g>
                )}
              </g>
            )
          })}

          {/* rubber-band line while connecting */}
          {connecting && (() => {
            const fn = mm.nodes.find((n) => n.id === connecting.fromId)
            if (!fn) return null
            const s = portCenter(fn)
            return <line x1={s.x} y1={s.y} x2={connecting.mx} y2={connecting.my}
              stroke={CYAN} strokeWidth="1.5" strokeDasharray="6 4"
              style={{ pointerEvents: 'none' }} />
          })()}

          {/* ── nodes — rendered above edges, pointer-events all ── */}
          {mm.nodes.map((n) => {
            const pal = PALETTE[n.color] || PALETTE.dim
            const ih = hNode === n.id
            const isSel = selectedId === n.id

            const borderColor = isSel ? ACCENT : ih ? ACCENT : LINE
            const borderWidth = isSel ? 2 : 1.5
            const boxShadow   = isSel
              ? `0 0 0 3px rgba(56,208,255,0.30), 0 1px 3px rgba(0,0,0,0.40)`
              : `0 1px 3px rgba(0,0,0,0.40)`

            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`}
                style={{ pointerEvents: 'all' }}
                onPointerEnter={() => setHNode(n.id)}
                onPointerLeave={() => setHNode(null)}>

                {/* node body — foreignObject for CSS border/shadow/radius */}
                <foreignObject x="0" y="0" width={NODE_W} height={NODE_H}
                  style={{ overflow: 'visible' }}>
                  <div
                    style={{
                      width: NODE_W,
                      height: NODE_H,
                      background: SURFACE2,
                      border: `${borderWidth}px solid ${borderColor}`,
                      borderRadius: '10px',
                      padding: '8px 14px',
                      fontSize: '13px',
                      minWidth: '80px',
                      textAlign: 'center',
                      cursor: 'move',
                      userSelect: 'none',
                      boxSizing: 'border-box',
                      boxShadow,
                      color: pal.text,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'border-color 0.12s, box-shadow 0.12s',
                      fontFamily: 'Inter, sans-serif',
                    }}
                    onPointerDown={(e) => onNodePtrDown(e, n.id, n.x, n.y)}
                    onDoubleClick={() => !connecting && setEditing({ id: n.id, label: n.label })}>

                    {editing?.id === n.id ? (
                      <input
                        style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', textAlign: 'center', fontSize: 13, fontFamily: 'Inter, sans-serif', color: pal.text }}
                        value={editing.label}
                        autoFocus
                        onChange={(ev) => setEditing({ id: n.id, label: ev.target.value })}
                        onBlur={finishEdit}
                        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === 'Escape') (ev.target as HTMLInputElement).blur() }}
                        onPointerDown={(ev) => ev.stopPropagation()}
                        onClick={(ev) => ev.stopPropagation()} />
                    ) : (
                      <span style={{ pointerEvents: 'none' }}>
                        {n.label.length > 18 ? n.label.slice(0, 18) + '…' : n.label}
                      </span>
                    )}
                  </div>
                </foreignObject>

                {/* × delete button — top-right corner, SVG above foreignObject */}
                {ih && (
                  <g onClick={(ev) => { ev.stopPropagation(); deleteNode(n.id) }} style={{ cursor: 'pointer' }}>
                    <circle cx={NODE_W - 8} cy={8} r="9"
                      fill="rgba(255,93,158,0.18)" stroke="rgba(255,93,158,0.50)" />
                    <text x={NODE_W - 8} y={8} textAnchor="middle" dominantBaseline="central"
                      fontSize="12" fill={PINK}
                      style={{ pointerEvents: 'none', fontFamily: 'Inter, sans-serif' }}>×</text>
                  </g>
                )}

                {/* ● connect port — visual indicator only; Shift+click node to connect */}
                <circle cx={NODE_W} cy={NODE_H / 2} r={PORT_R}
                  fill={connecting?.fromId === n.id ? CYAN : (ih ? 'rgba(56,208,255,0.18)' : 'transparent')}
                  stroke={ih ? CYAN : 'transparent'}
                  strokeWidth="1.5"
                  style={{ pointerEvents: 'none' }} />

                {/* color swatches below node on hover */}
                {ih && (
                  <g>
                    {PALETTE_KEYS.map((ck, i) => (
                      <circle key={ck}
                        cx={8 + i * 16} cy={NODE_H + 13} r="5.5"
                        fill={PALETTE[ck].fill}
                        stroke={ck === n.color ? PALETTE[ck].stroke : 'rgba(127,179,214,0.22)'}
                        strokeWidth={ck === n.color ? 2 : 1}
                        style={{ cursor: 'pointer' }}
                        onClick={(ev) => { ev.stopPropagation(); commit({ ...mmRef.current, nodes: mmRef.current.nodes.map((nd) => nd.id === n.id ? { ...nd, color: ck } : nd) }) }} />
                    ))}
                  </g>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {/* empty-state hint */}
      {mm.nodes.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, opacity: 0.2, marginBottom: 12 }}>🗺</div>
            <div style={{ fontSize: 13, color: INKFAINT }}>
              Bấm <b style={{ color: CYAN }}>+ Node</b> để bắt đầu
            </div>
            <div style={{ fontSize: 11, color: '#3a4e60', marginTop: 6 }}>
              Kéo node · Dblclick đặt tên · Shift+click nối · × xóa · Esc bỏ chọn
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
