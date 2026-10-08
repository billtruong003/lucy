// Cây tri thức — vẽ graph nối folder kiểu GitNexus (tree layout tầng + edge chéo [[wiki-link]]).
// 2 nguồn: vault (Brain/Projects/…) và tài nguyên VPS (pm2→port←nginx, cron, disk).
// Render SVG thuần (yêu cầu render-perf: ≤900 node, không lib nặng); pan/zoom qua viewBox.
// Physics: seed từ treeLayout → TreeSim chạy ĐỒNG BỘ 1 lần tới lắng (budget ms) rồi cache layout
// vào localStorage theo hash graph → mở lại tab/reload là hiện tức thì, không init + không rAF lag.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { kgraph, type KGraphData, type KGraphNode, type KGraphSrc } from '../api'
import { treeLayout } from '../lib/treeLayout'
import { TreeSim, type PhysNode } from '../lib/treePhysics'
import { Chip, Button, ErrorState } from './ui'

// màu theo kind — bám palette hub (cyan/gold/grn/rose/violet), node tri thức đậm nhạt theo tầng
const KIND_COLOR: Record<string, string> = {
  root: '#a78bfa', folder: '#8b5cf6', note: '#22d3ee',
  'note-user': '#f472b6', 'note-feedback': '#fb923c', 'note-project': '#ffd166', 'note-reference': '#34d399',
  agg: '#64748b',
  svc: '#34d399', 'svc-off': '#f87171', port: '#ffd166', route: '#22d3ee', cron: '#fb923c', res: '#a78bfa',
  site: '#f472b6', proc: '#94a3b8', dir: '#fbbf24', sysd: '#60a5fa', ctr: '#38bdf8',
  // mode code (gitnexus): repo/folder/file + symbol theo loại
  repo: '#a78bfa', cdir: '#8b5cf6', cfile: '#22d3ee', fn: '#34d399', cls: '#ffd166', meth: '#f472b6', iface: '#fb923c',
  // mode files (cây thư mục VPS)
  froot: '#a78bfa', fdir: '#fbbf24', ffile: '#38bdf8',
}
const KIND_SIZE: Record<string, number> = {
  root: 11, folder: 8, svc: 8, route: 6, cron: 6, res: 8, port: 5, agg: 5, site: 7, proc: 4, dir: 5, sysd: 6, ctr: 6,
  repo: 11, cdir: 7, cfile: 6, fn: 5, cls: 6, meth: 5, iface: 5,
}
// files mode: bán kính ánh xạ theo size (log) — thư mục/file to → node to
const sizeOf = (n: KGraphNode) => {
  if (n.kind === 'froot') return 12
  if (n.val != null) return Math.max(3, Math.min(16, 3 + Math.log10((n.val || 0) + 10) * 1.5))
  return KIND_SIZE[n.kind] ?? 5
}
const fmtBytes = (n: number) => n >= 1e9 ? (n / 1e9).toFixed(1) + 'G' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : n + 'B'
const MODES: { id: KGraphSrc; label: string }[] = [
  { id: 'vault', label: '🧠 Tri thức' }, { id: 'vps', label: '🖥️ VPS' },
  { id: 'code', label: '🧬 Code' }, { id: 'files', label: '🗂️ Files' },
]
// Cache 2 tầng: data theo key (RAM 5' + localStorage sống qua reload, stale-while-revalidate)
// + layout đã lắng (localStorage theo hash) → hết cảnh "mỗi lần vô init từ đầu khá lâu".
const memData = new Map<string, { at: number; data: KGraphData }>()
const DATA_TTL = 300_000
const lsGet = <T,>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* quota đầy → bỏ qua */ } }
const graphHash = (d: KGraphData) => d.nodes.length + ':' + d.edges.length + ':' + (d.nodes[0]?.id || '')

const LEGEND: Record<KGraphSrc, [string, string][]> = {
  vault: [['root', 'nhánh'], ['note', 'note'], ['note-project', 'project'], ['note-feedback', 'feedback'], ['note-reference', 'reference']],
  vps: [['svc', 'pm2'], ['port', 'port'], ['site', 'domain'], ['route', 'route'], ['cron', 'cron'], ['res', 'tài nguyên'], ['dir', 'thư mục'], ['sysd', 'systemd']],
  code: [['repo', 'repo'], ['cdir', 'folder'], ['cfile', 'file'], ['fn', 'function'], ['cls', 'class'], ['meth', 'method'], ['iface', 'interface']],
  files: [['froot', 'gốc'], ['fdir', 'thư mục'], ['ffile', 'file']],
}

export default function KGraph({ visible }: { visible: boolean }) {
  const [src, setSrc] = useState<KGraphSrc>('vault')
  const [daily, setDaily] = useState(false)
  const [data, setData] = useState<KGraphData | null>(null)
  const [building, setBuilding] = useState(false)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const loadedKey = useRef('')
  const loadSeq = useRef(0)
  const svgRef = useRef<SVGSVGElement>(null)
  // viewBox pan/zoom: {x,y,w} (h theo tỷ lệ khung)
  const [view, setView] = useState({ x: -640, y: -120, w: 1280 })
  const drag = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null)

  const key = src + (daily ? '+d' : '')
  // mode 'code' lần đầu trả {building:true} → poll lại sau 4s tới khi build xong
  const fetchGraph = useCallback((force = false) => {
    const seq = ++loadSeq.current
    setErr(''); setBuilding(false); setSel(null)
    // cache RAM → localStorage: còn tươi thì khỏi gọi mạng; cũ thì hiện ngay + refresh nền
    const cached = force ? null : memData.get(key) || lsGet<{ at: number; data: KGraphData }>('kg:data:' + key)
    if (cached) {
      setData(cached.data)
      if (Date.now() - cached.at < DATA_TTL) return
    } else setData(null)
    const go = () => {
      kgraph(src, daily).then((d) => {
        if (seq !== loadSeq.current) return
        if (d.building) { setBuilding(true); setTimeout(go, 4000) } else {
          setBuilding(false); setData(d)
          const entry = { at: Date.now(), data: d }
          memData.set(key, entry)
          if (!d.stale) lsSet('kg:data:' + key, entry)   // bản stale không cache lâu dài
        }
      }).catch((e) => { if (seq === loadSeq.current && !cached) setErr(String(e)) })
    }
    go()
  }, [src, daily, key])
  useEffect(() => {
    if (!visible || loadedKey.current === key) return
    loadedKey.current = key
    fetchGraph()
  }, [visible, key, fetchGraph])

  const { pos, neighbors, edges } = useMemo(() => {
    if (!data) return { pos: new Map<string, PhysNode>(), neighbors: new Map<string, Set<string>>(), edges: [] as KGraphData['edges'] }
    const physEdges = data.edges.map((e) => ({ source: e.source, target: e.target, hier: e.hier }))
    const hash = graphHash(data)
    const posKey = 'kg:pos:' + key
    const saved = lsGet<{ h: string; p: Record<string, [number, number]> }>(posKey)
    let phys: PhysNode[]
    if (saved && saved.h === hash) {
      // layout đã lắng từ lần trước → hiện tức thì, khỏi chạy physics lại
      phys = data.nodes.map((n) => {
        const c = saved.p[n.id]
        return { id: n.id, layer: n.layer, size: sizeOf(n), x: c?.[0] ?? 0, y: c?.[1] ?? n.layer * 190 }
      })
    } else {
      // seed X/Y từ layout tĩnh → sim chạy ĐỒNG BỘ tới lắng (budget ~600ms wall) đúng 1 lần,
      // bỏ animate từng frame qua rAF (nguồn lag cũ) → cache kết quả cho các lần sau
      const layerCount = Math.max(4, ...data.nodes.map((n) => n.layer)) + 1
      const seed = treeLayout(data.nodes.map((n) => ({ id: n.id, layer: n.layer, size: sizeOf(n) })), physEdges, layerCount)
      phys = data.nodes.map((n) => {
        const sp = seed.get(n.id)
        return { id: n.id, layer: n.layer, size: sizeOf(n), x: sp?.x ?? 0, y: sp?.y ?? n.layer * 190 }
      })
      const s = new TreeSim(phys, physEdges, 190)
      const t0 = performance.now()
      let ts = 0
      while (!s.done && performance.now() - t0 < 600) { ts += 32; s.step(ts) }
      lsSet(posKey, { h: hash, p: Object.fromEntries(phys.map((p) => [p.id, [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]])) })
    }
    const nb = new Map<string, Set<string>>()
    for (const e of data.edges) {
      if (!nb.has(e.source)) nb.set(e.source, new Set())
      if (!nb.has(e.target)) nb.set(e.target, new Set())
      nb.get(e.source)!.add(e.target); nb.get(e.target)!.add(e.source)
    }
    return { pos: new Map(phys.map((p) => [p.id, p])), neighbors: nb, edges: data.edges }
  }, [data, key])

  const nodeById = useMemo(() => new Map((data?.nodes || []).map((n) => [n.id, n])), [data])
  const active = sel || hover
  const activeSet = active ? neighbors.get(active) : null

  // pan/zoom — chuột: kéo pan, wheel zoom quanh con trỏ
  const toWorld = useCallback((e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { wx: view.x + ((e.clientX - r.left) / r.width) * view.w, wy: view.y + ((e.clientY - r.top) / r.height) * view.w * (r.height / r.width) }
  }, [view])
  const onWheel = useCallback((e: React.WheelEvent) => {
    const { wx, wy } = toWorld(e)
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15
    setView((v) => {
      const w = Math.min(4000, Math.max(120, v.w * k))
      return { x: wx - (wx - v.x) * (w / v.w), y: wy - (wy - v.y) * (w / v.w), w }
    })
  }, [toWorld])
  const onDown = (e: React.PointerEvent) => {
    drag.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const r = svgRef.current!.getBoundingClientRect()
    setView((v) => ({ ...v, x: drag.current!.vx - ((e.clientX - drag.current!.px) / r.width) * v.w, y: drag.current!.vy - ((e.clientY - drag.current!.py) / r.width) * v.w }))
  }
  const onUp = () => { drag.current = null }
  const resetView = () => setView({ x: -640, y: -120, w: 1280 })

  const selNode = sel ? nodeById.get(sel) : null
  const zoomedIn = view.w < 700   // đủ gần mới hiện label node lá (render-perf + đỡ rối)

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-4 sm:px-6 pt-4 pb-2 flex-wrap">
        <div className="flex rounded-lg border border-line overflow-hidden">
          {MODES.map((m) => (
            <button key={m.id} onClick={() => setSrc(m.id)}
              className={'px-3 py-1.5 text-xs transition-colors ' + (src === m.id ? 'bg-cyan/15 text-cyan' : 'text-inkdim hover:text-ink')}>
              {m.label}
            </button>
          ))}
        </div>
        {src === 'vault' && (
          <label className="flex items-center gap-1.5 text-[11px] text-inkdim cursor-pointer select-none">
            <input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} className="accent-cyan" /> kèm Daily
          </label>
        )}
        <div className="flex-1" />
        {data?.stale && <Chip>bản cũ · đang cập nhật…</Chip>}
        {data && <Chip>{data.nodes.length} node · {data.edges.length} liên kết</Chip>}
        <Button variant="ghost" className="!py-1 !px-2 text-xs" onClick={resetView}>⊕ Reset</Button>
        <Button variant="ghost" className="!py-1 !px-2 text-xs" onClick={() => fetchGraph(true)}>↻</Button>
      </div>

      <div className="flex-1 min-h-0 relative mx-4 sm:mx-6 mb-4 rounded-xl border border-line bg-[#0a0a12] overflow-hidden">
        {err && <ErrorState message={err} onRetry={() => fetchGraph(true)} />}
        {!err && !data && (
          <div className="absolute inset-0 grid place-items-center text-inkfaint text-sm mono animate-pulse text-center px-4">
            {building ? 'đang build code graph lần đầu (gitnexus ~1 phút)…' : 'đang dựng cây tri thức…'}
          </div>
        )}
        {data && (
          <svg ref={svgRef} className="w-full h-full touch-none" style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.w * 0.62}`}
            onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
            onClick={(e) => { if (e.target === e.currentTarget) setSel(null) }}>
            {/* glow cho node gốc — nhìn "GitNexus" hơn mà rẻ (chỉ vài node layer 0) */}
            <defs>
              <filter id="kgGlow" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="3.5" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {/* edges: hier mờ, cross ([[link]]/PROXY) sáng — cong nhẹ kiểu edge-curve */}
            <g>
              {edges.map((e, i) => {
                const s = pos.get(e.source), t = pos.get(e.target)
                if (!s || !t) return null
                const on = active && (e.source === active || e.target === active)
                const dim = active && !on
                const mx = (s.x + t.x) / 2 + (t.y - s.y) * 0.12
                const my = (s.y + t.y) / 2 - (t.x - s.x) * 0.12
                const col = on ? (e.hier ? '#22d3ee' : '#ffd166') : e.hier ? '#233043' : '#7a6a3a'
                return <path key={i} d={`M${s.x},${s.y} Q${mx},${my} ${t.x},${t.y}`} fill="none" strokeLinecap="round"
                  stroke={col} strokeWidth={on ? 1.6 : e.hier ? 0.6 : 0.9} opacity={dim ? 0.12 : on ? 0.95 : e.hier ? 0.5 : 0.65} />
              })}
            </g>
            {/* nodes */}
            <g>
              {data.nodes.map((n) => {
                const p = pos.get(n.id)
                if (!p) return null
                const isActive = active === n.id
                const isNb = activeSet?.has(n.id)
                const dim = active && !isActive && !isNb
                const c = KIND_COLOR[n.kind] || '#6b7280'
                const r = p.size * (isActive ? 1.7 : isNb ? 1.25 : 1)
                const showLabel = n.layer <= (src === 'vault' ? 0 : 1) || isActive || isNb || zoomedIn
                return (
                  <g key={n.id} className="cursor-pointer"
                    onClick={(ev) => { ev.stopPropagation(); setSel(sel === n.id ? null : n.id) }}
                    onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}>
                    {isActive && <circle cx={p.x} cy={p.y} r={r + 5} fill="none" stroke={c} strokeWidth={1.5} opacity={0.5} />}
                    {/* viền đứt = node có URL bấm mở được (xem panel chi tiết) */}
                    {n.url && !dim && <circle cx={p.x} cy={p.y} r={r + 2.5} fill="none" stroke={c} strokeWidth={0.7} strokeDasharray="2 2" opacity={0.55} />}
                    <circle cx={p.x} cy={p.y} r={r} fill={c} opacity={dim ? 0.18 : 1}
                      stroke="#0a0a12" strokeWidth={0.8} filter={n.layer === 0 ? 'url(#kgGlow)' : undefined} />
                    {showLabel && !dim && (
                      <text x={p.x} y={p.y - r - 4} textAnchor="middle" fontSize={n.layer === 0 ? 12 : 9.5}
                        fill={isActive ? '#f5f5f7' : '#9aa3b2'} stroke="#0a0a12" strokeWidth={3} paintOrder="stroke"
                        style={{ fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none' }}>
                        {n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
        )}
        {/* panel chi tiết node chọn */}
        {selNode && (
          <div className="absolute right-3 top-3 w-64 max-w-[calc(100%-1.5rem)] glass rounded-xl border border-line p-3 text-xs">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: KIND_COLOR[selNode.kind] || '#6b7280' }} />
              <span className="text-ink font-medium break-all">{selNode.label}</span>
            </div>
            <div className="text-inkfaint mono text-[10px] break-all">{selNode.meta || selNode.kind}</div>
            {selNode.val != null && <div className="text-inkdim mono text-[10px] mt-0.5">{fmtBytes(selNode.val)}</div>}
            <div className="text-inkdim mt-1.5">{(neighbors.get(selNode.id)?.size ?? 0)} liên kết · tầng {selNode.layer}</div>
            {selNode.url && (
              <a href={selNode.url} target="_blank" rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-cyan hover:underline break-all text-[11px]">
                ↗ {selNode.url.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        )}
        {/* chú giải */}
        <div className="absolute left-3 bottom-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-inkfaint mono pointer-events-none">
          {LEGEND[src].map(([k, l]) => (
            <span key={k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k] }} />{l}</span>))}
          <span className="text-inkfaint/70">· vàng = liên kết chéo · viền đứt = có link · kéo/lăn để pan/zoom</span>
        </div>
      </div>
    </div>
  )
}
