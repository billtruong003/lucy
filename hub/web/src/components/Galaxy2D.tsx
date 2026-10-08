import { useEffect, useRef, useState } from 'react'
import { brainGraph, brainFile, type GraphNode, type GraphLink } from '../api'
import { ZONE_COLOR, hash01 } from './viz3d'
import Markdown from './Markdown'

// ════════ TINH HÀ 2D — FALLBACK non-WebGL (S5/E4.2) ════════
// Khi máy/khách KHÔNG có WebGL (GPU yếu, headless, policy chặn) → vẫn xem được tinh hà:
// canvas 2D vẽ hành tinh (note thật) + đường sao (wikilink) + cụm theo zone. Pan/zoom/hover/click.
// Render-on-demand (chỉ vẽ khi dirty) → nhẹ CPU, hợp client yếu. KHÔNG animation (tôn trọng reduced-motion).

const ZONE_LABEL: Record<string, string> = {
  context: 'Bối cảnh', projects: 'Dự án', learned: 'Đã học', entities: 'Thực thể',
  skills: 'Kỹ năng', timeline: 'Nhật ký', decisions: 'Quyết định', memory: 'Ký ức', agents: 'Não agent', ghost: 'Chưa viết',
}

type P2 = { x: number; y: number }

// layout 2D deterministic: mỗi zone = 1 cụm trên vòng tròn; node rải quanh tâm cụm theo hash. Core = giữa.
function layout2D(nodes: GraphNode[], links: GraphLink[]): { pos: Map<string, P2>; coreId: string } {
  const deg = new Map<string, number>()
  for (const l of links) { deg.set(l.source, (deg.get(l.source) || 0) + 1); deg.set(l.target, (deg.get(l.target) || 0) + 1) }
  let coreId = '', best = -1
  for (const n of nodes) { const d = deg.get(n.id) || 0; if (!n.ghost && d > best) { best = d; coreId = n.id } }

  const zones = [...new Set(nodes.map((n) => n.zone))]
  const Z = Math.max(1, zones.length)
  const RING = 320
  const zc = new Map<string, P2>()
  zones.forEach((z, i) => {
    const a = (i / Z) * Math.PI * 2
    zc.set(z, Z === 1 ? { x: 0, y: 0 } : { x: Math.cos(a) * RING, y: Math.sin(a) * RING })
  })
  // bán kính cụm ∝ số node trong zone
  const zcount = new Map<string, number>()
  for (const n of nodes) zcount.set(n.zone, (zcount.get(n.zone) || 0) + 1)

  const pos = new Map<string, P2>()
  for (const n of nodes) {
    if (n.id === coreId) { pos.set(n.id, { x: 0, y: 0 }); continue }
    const c = zc.get(n.zone) || { x: 0, y: 0 }
    const cr = 60 + Math.sqrt(zcount.get(n.zone) || 1) * 26
    const a = hash01(n.id) * Math.PI * 2
    const rr = Math.pow(hash01(n.id + 'r'), 0.6) * cr
    pos.set(n.id, { x: c.x + Math.cos(a) * rr, y: c.y + Math.sin(a) * rr })
  }
  return { pos, coreId }
}

export default function Galaxy2D({ visible }: { visible: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const S = useRef<any>({ pos: new Map(), nodes: [], links: [], coreId: '', cam: { x: 0, y: 0, scale: 1 }, hoverId: null, dirty: true })
  const [meta, setMeta] = useState({ nodes: 0, links: 0, learned: 0, configured: true, offline: false })
  const [hover, setHover] = useState<{ x: number; y: number; n: GraphNode } | null>(null)
  const [sel, setSel] = useState<{ node: GraphNode; doc: string } | null>(null)

  // ---- poll graph ----
  useEffect(() => {
    if (!visible) return
    let alive = true
    const pull = async () => {
      try {
        const g = await brainGraph(); if (!alive) return
        if (g.configured === false) { setMeta((m) => ({ ...m, configured: false, offline: !!g.offline })); return }
        const nodes = g.nodes || [], links = g.links || []
        const { pos, coreId } = layout2D(nodes, links)
        const s = S.current; s.nodes = nodes; s.links = links; s.pos = pos; s.coreId = coreId; s.dirty = true
        setMeta({ nodes: nodes.length, links: links.length, learned: nodes.filter((n) => n.kind === 'preference').length, configured: true, offline: false })
      } catch { if (alive) setMeta((m) => ({ ...m, offline: true })) }
    }
    pull(); const iv = setInterval(pull, 4000)
    return () => { alive = false; clearInterval(iv) }
  }, [visible])

  // ---- canvas render-on-demand (chỉ vẽ khi dirty) ----
  useEffect(() => {
    const cv = canvasRef.current, wrap = wrapRef.current; if (!cv || !wrap) return
    const ctx = cv.getContext('2d')!
    let raf = 0
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const resize = () => { const w = wrap.clientWidth, h = wrap.clientHeight; cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px'; S.current.dirty = true }
    resize()
    const ro = new ResizeObserver(resize); ro.observe(wrap)

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const s = S.current; if (!visible || !s.dirty) return
      s.dirty = false
      const w = cv.width, h = cv.height
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#06090f'; ctx.fillRect(0, 0, w, h)
      const cam = s.cam
      ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, w / 2 + cam.x * dpr, h / 2 + cam.y * dpr)
      // đường sao
      ctx.lineWidth = 0.6 / cam.scale; ctx.strokeStyle = 'rgba(95,208,255,0.10)'
      ctx.beginPath()
      for (const l of s.links as GraphLink[]) { const a = s.pos.get(l.source), b = s.pos.get(l.target); if (!a || !b) continue; ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y) }
      ctx.stroke()
      // hành tinh
      for (const n of s.nodes as GraphNode[]) {
        const p = s.pos.get(n.id); if (!p) continue
        const isCore = n.id === s.coreId
        const rad = isCore ? 11 : 3 + Math.cbrt(n.mass || 1) * 1.6
        const col = n.ghost ? '#46566a' : (ZONE_COLOR[n.zone] || '#7fb0d0')
        ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2)
        ctx.fillStyle = col; ctx.globalAlpha = n.ghost ? 0.4 : (0.45 + (n.brightness || 0.5) * 0.55)
        ctx.fill(); ctx.globalAlpha = 1
        if (n.id === s.hoverId) { ctx.lineWidth = 2 / cam.scale; ctx.strokeStyle = '#eafaff'; ctx.stroke() }
        // nhãn: core luôn hiện; node thường khi zoom đủ gần
        if ((isCore || cam.scale > 1.1) && !n.ghost) {
          ctx.fillStyle = col; ctx.globalAlpha = isCore ? 0.95 : 0.7
          ctx.font = `${isCore ? 13 : 10}px "Space Grotesk", sans-serif`
          ctx.fillText(n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label, p.x + rad + 3, p.y + 3)
          ctx.globalAlpha = 1
        }
      }
    }
    raf = requestAnimationFrame(draw)

    // ---- tương tác: pan (drag) · zoom (wheel) · hover · click ----
    const toWorld = (e: PointerEvent | WheelEvent): P2 => {
      const b = cv.getBoundingClientRect(), cam = S.current.cam
      return { x: ((e.clientX - b.left) - b.width / 2 - cam.x) / cam.scale, y: ((e.clientY - b.top) - b.height / 2 - cam.y) / cam.scale }
    }
    const pick = (e: PointerEvent): GraphNode | null => {
      const wpt = toWorld(e), s = S.current; let bestN: GraphNode | null = null, bestD = 16 / s.cam.scale
      for (const n of s.nodes as GraphNode[]) { const p = s.pos.get(n.id); if (!p) continue; const d = Math.hypot(p.x - wpt.x, p.y - wpt.y); if (d < bestD) { bestD = d; bestN = n } }
      return bestN
    }
    let dragging = false, downX = 0, downY = 0, moved = false
    const onDown = (e: PointerEvent) => { dragging = true; moved = false; downX = e.clientX; downY = e.clientY; cv.setPointerCapture(e.pointerId) }
    const onMove = (e: PointerEvent) => {
      const s = S.current
      if (dragging) {
        if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 3) moved = true
        s.cam.x += e.movementX; s.cam.y += e.movementY; s.dirty = true; return
      }
      const n = pick(e)
      if ((n?.id || null) !== s.hoverId) { s.hoverId = n?.id || null; s.dirty = true; cv.style.cursor = n ? 'pointer' : 'grab' }
      setHover(n ? { x: e.clientX, y: e.clientY, n } : null)
    }
    const onUp = (e: PointerEvent) => {
      dragging = false; try { cv.releasePointerCapture(e.pointerId) } catch { /* */ }
      if (!moved) { const n = pick(e); if (n && !n.ghost) openNote(n) }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); const s = S.current, before = toWorld(e)
      s.cam.scale = Math.min(4, Math.max(0.25, s.cam.scale * (e.deltaY < 0 ? 1.12 : 0.89)))
      const after = toWorld(e); s.cam.x += (after.x - before.x) * s.cam.scale; s.cam.y += (after.y - before.y) * s.cam.scale; s.dirty = true
    }
    cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerup', onUp); cv.addEventListener('wheel', onWheel, { passive: false })
    cv.style.touchAction = 'none'

    return () => {
      cancelAnimationFrame(raf); ro.disconnect()
      cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerup', onUp); cv.removeEventListener('wheel', onWheel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  async function openNote(n: GraphNode) {
    setSel({ node: n, doc: '…' })
    if (!n.path) { setSel({ node: n, doc: '_(không có file)_' }); return }
    const d = await brainFile(n.path)
    setSel({ node: n, doc: d.content || '_(không đọc được)_' })
  }

  if (!meta.configured) return (
    <div className="h-full grid place-items-center px-6">
      <div className="card max-w-md p-6 text-center">
        <div className="text-3xl mb-2">🌌</div>
        <div className="display text-cyan tracking-wide mb-2">TINH HÀ CHƯA BẬT</div>
        <p className="text-[13px] text-inkdim leading-relaxed">Đặt <code className="text-cyan">LUCY_VAULT</code> cho coordinator rồi restart.{meta.offline && <span className="block mt-2 text-pink">· coordinator offline.</span>}</p>
      </div>
    </div>
  )

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden" style={{ background: '#06090f', cursor: 'grab' }}>
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* badge fallback — báo rõ đang ở chế độ 2D vì không có WebGL */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 chip bg-black/50 backdrop-blur text-inkdim">🛰️ chế độ 2D · máy không có WebGL · kéo/zoom/click</div>

      {/* hover tooltip */}
      {hover && (
        <div className="fixed z-30 pointer-events-none px-2.5 py-1.5 rounded-lg bg-black/80 border border-line text-center"
          style={{ left: hover.x + 14, top: hover.y + 10 }}>
          <div className="text-[13px] font-semibold" style={{ color: ZONE_COLOR[hover.n.zone] || '#cfe6f5' }}>{hover.n.label}</div>
          <div className="text-[10px] text-inkdim">{ZONE_LABEL[hover.n.zone] || hover.n.zone} · {hover.n.kind}</div>
        </div>
      )}

      {/* meta footer */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-20 pointer-events-none text-[11px] text-inkfaint">{meta.nodes} hành tinh · {meta.links} đường sao · {meta.learned} đã học{meta.offline ? ' · offline' : ''}</div>

      {/* legend */}
      <div className="absolute top-3 right-4 flex flex-col gap-1 text-[10px] pointer-events-none z-20">
        {Object.entries(ZONE_LABEL).filter(([z]) => z !== 'ghost').map(([z, lb]) => (
          <div key={z} className="flex items-center gap-1.5" style={{ color: ZONE_COLOR[z] }}>
            <span style={{ width: 8, height: 8, borderRadius: 9, background: ZONE_COLOR[z] }} /> {lb}
          </div>
        ))}
      </div>

      {/* note panel */}
      {sel && (
        <div className="absolute top-0 right-0 h-full w-[min(440px,92%)] z-30 bg-panel/95 backdrop-blur border-l border-line flex flex-col shadow-2xl">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-line shrink-0">
            <span style={{ color: ZONE_COLOR[sel.node.zone] }}>●</span>
            <span className="text-[13px] text-cyan font-medium truncate flex-1">{sel.node.label}</span>
            <button className="btn btn-icon !w-8 !h-8 shrink-0" aria-label="Đóng ghi chú" onClick={() => setSel(null)}>✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4"><div className="card p-4"><Markdown>{sel.doc.replace(/^---[\s\S]*?\n---\n/, '').trim()}</Markdown></div></div>
        </div>
      )}
    </div>
  )
}
