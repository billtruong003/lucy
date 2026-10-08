// Constellation — brain viz HUD (thay galaxy): lõi Lucy tâm → node theo vòng zone,
// size=mass, màu=zone, link=relation. Hover → highlight + tooltip. Pan/zoom nhẹ.
import { useEffect, useMemo, useRef, useState } from 'react'
import { brainGraph, type GraphNode, type GraphLink } from '../api'

// zone → màu (viz token HUD)
const ZONE: Record<string, { c: string; label: string; r: number }> = {
  context:  { c: 'var(--accent)',  label: 'context',  r: 0.30 },
  projects: { c: 'var(--viz-1)',   label: 'project',  r: 0.50 },
  learned:  { c: 'var(--viz-2)',   label: 'learned',  r: 0.66 },
  memory:   { c: 'var(--viz-3)',   label: 'memory',   r: 0.80 },
  timeline: { c: 'var(--viz-7)',   label: 'timeline', r: 0.92 },
  agents:   { c: 'var(--viz-5)',   label: 'agents',   r: 0.40 },
  ghost:    { c: 'var(--text-disabled)', label: 'ghost', r: 0.95 },
}
const zoneColor = (z: string) => ZONE[z]?.c || 'var(--text-muted)'

type Placed = GraphNode & { x: number; y: number; rad: number }

export default function Constellation({ visible }: { visible: boolean }) {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [links, setLinks] = useState<GraphLink[]>([])
  const [loaded, setLoaded] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const [view, setView] = useState({ z: 1, x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const box = 900  // viewBox vuông

  useEffect(() => {
    if (!visible || loaded) return
    brainGraph(0).then((d) => { setNodes(d.nodes || []); setLinks(d.links || []); setLoaded(true) }).catch(() => setLoaded(true))
  }, [visible, loaded])

  // layout radial: center = identity/context lớn nhất; mỗi zone 1 vòng, góc theo index
  const placed = useMemo(() => {
    const cx = box / 2, cy = box / 2
    const R = box * 0.46
    const byZone: Record<string, GraphNode[]> = {}
    for (const n of nodes) (byZone[n.zone] ||= []).push(n)
    const map = new Map<string, Placed>()
    const core = nodes.find((n) => n.kind === 'identity') || nodes[0]
    for (const [zone, list] of Object.entries(byZone)) {
      const ring = (ZONE[zone]?.r ?? 0.7) * R
      list.sort((a, b) => b.mass - a.mass)
      list.forEach((n, i) => {
        if (n === core) { map.set(n.id, { ...n, x: cx, y: cy, rad: 16 }); return }
        const a = (i / Math.max(1, list.length)) * Math.PI * 2 + (zone.length * 0.7)
        const jitter = ((n.mass * 37) % 40) - 20
        map.set(n.id, { ...n, x: cx + Math.cos(a) * (ring + jitter), y: cy + Math.sin(a) * (ring + jitter),
          rad: Math.max(2.5, Math.min(9, 2 + n.mass * 0.22)) })
      })
    }
    return map
  }, [nodes])

  const hoverNode = hover ? placed.get(hover) : null
  const hoverLinks = useMemo(() => {
    if (!hover) return new Set<string>()
    const s = new Set<string>()
    for (const l of links) { if (l.source === hover) s.add(l.target); if (l.target === hover) s.add(l.source) }
    return s
  }, [hover, links])

  // pan/zoom
  function onWheel(e: React.WheelEvent) { e.preventDefault(); setView((v) => ({ ...v, z: Math.max(0.5, Math.min(4, v.z * (e.deltaY < 0 ? 1.12 : 0.9))) })) }
  function onDown(e: React.MouseEvent) { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y } }
  function onMove(e: React.MouseEvent) { if (!drag.current) return; const d = drag.current; setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) })) }
  function onUp() { drag.current = null }

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const n of nodes) c[n.zone] = (c[n.zone] || 0) + 1
    return c
  }, [nodes])

  return (
    <div className="absolute inset-0 overflow-hidden select-none"
      onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
      style={{ cursor: drag.current ? 'grabbing' : 'grab' }}>
        <div className="absolute top-4 left-4 z-10 hud-lbl">Knowledge Constellation // {nodes.length} node</div>
        {!loaded && <div className="absolute inset-0 flex items-center justify-center hud-lbl text-cyan">◐ đang nạp constellation…</div>}
        <svg viewBox={`0 0 ${box} ${box}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full">
          <g transform={`translate(${box / 2 + view.x} ${box / 2 + view.y}) scale(${view.z}) translate(${-box / 2} ${-box / 2})`}>
            {/* orbital rings — chỉ zone có node, mờ */}
            {Object.entries(ZONE).filter(([z]) => counts[z]).map(([z, cfg]) => (
              <circle key={z} cx={box / 2} cy={box / 2} r={cfg.r * box * 0.46} fill="none"
                stroke={cfg.c} strokeOpacity={0.07} strokeWidth={1} strokeDasharray="1 11" />
            ))}
            {/* links */}
            {links.map((l, i) => {
              const a = placed.get(l.source), b = placed.get(l.target)
              if (!a || !b) return null
              const on = hover && (l.source === hover || l.target === hover)
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={on ? 'var(--accent)' : zoneColor(a.zone)} strokeOpacity={on ? 0.5 : (hover ? 0.03 : 0.09)} strokeWidth={on ? 1.3 : 0.7} />
            })}
            {/* nodes */}
            {[...placed.values()].map((n) => {
              const dim = hover && hover !== n.id && !hoverLinks.has(n.id)
              const c = zoneColor(n.zone)
              return (
                <g key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
                  <circle cx={n.x} cy={n.y} r={n.rad} fill={c} fillOpacity={dim ? 0.15 : 0.95}
                    style={{ filter: dim || n.rad < 4 ? 'none' : `drop-shadow(0 0 ${n.rad}px ${c})` }} />
                  {(n.rad > 6 || hover === n.id) && !dim && (
                    <text x={n.x + n.rad + 3} y={n.y + 3} fontSize={hover === n.id ? 12 : 9}
                      fill={hover === n.id ? 'var(--text-primary)' : 'var(--text-muted)'} fontFamily="Share Tech Mono">{n.label.slice(0, 22)}</text>
                  )}
                </g>
              )
            })}
            {/* core glow */}
            {(() => { const core = [...placed.values()].find((n) => n.kind === 'identity'); if (!core) return null
              return <><circle cx={core.x} cy={core.y} r={34} fill="var(--accent)" fillOpacity={0.12} />
                <circle cx={core.x} cy={core.y} r={9} fill="var(--accent)" style={{ filter: 'drop-shadow(0 0 16px var(--accent))' }} />
                <text x={core.x} y={core.y + 52} textAnchor="middle" fill="var(--accent)" fontSize={11} letterSpacing={3} fontFamily="Share Tech Mono">L U C Y</text></>
            })()}
          </g>
        </svg>
        {/* hover tooltip */}
        {hoverNode && (
          <div className="absolute bottom-4 left-4 z-10 card p-3 max-w-xs">
            <div className="hud-lbl" style={{ color: zoneColor(hoverNode.zone) }}>{hoverNode.kind} · {hoverNode.zone}</div>
            <div className="text-[13px] text-ink mt-1">{hoverNode.label}</div>
            {hoverNode.obs > 0 && <div className="text-[11px] text-inkfaint mt-1 num">{hoverNode.obs} quan sát · mass {hoverNode.mass.toFixed(0)}</div>}
          </div>
        )}
        <div className="absolute bottom-4 right-4 z-10 hud-lbl hidden sm:block">cuộn = zoom · kéo = pan</div>

      {/* index panel — overlay góc phải, ẩn trên mobile (nhường chỗ constellation) */}
      <div className="absolute top-14 right-4 z-10 w-48 hidden sm:flex flex-col gap-2.5 pointer-events-none">
        <div className="card p-3 hud-frame amber pointer-events-auto">
          <div className="hud-lbl">Index</div>
          <div className="num text-2xl text-gold mt-1">{nodes.length}</div>
          <div className="text-[11px] text-inkfaint">node · {links.length} link</div>
        </div>
        <div className="card p-3 pointer-events-auto">
          <div className="hud-lbl mb-2">Cụm tri thức</div>
          <div className="flex flex-col gap-1.5">
            {Object.entries(ZONE).filter(([z]) => counts[z]).map(([z, cfg]) => (
              <div key={z} className="flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: cfg.c, boxShadow: `0 0 6px ${cfg.c}` }} /><span className="text-inkdim">{cfg.label}</span></span>
                <span className="num text-inkfaint">{counts[z]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
