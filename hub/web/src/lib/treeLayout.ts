// Tree layout kiểu GitNexus (port từ gitnexus-web/src/lib/tree-layout.ts, PolyForm Noncommercial —
// chỉ dùng nội bộ hub, KHÔNG đem vào sản phẩm bán như Strataro).
// Ý tưởng: node chia TẦNG theo layer (0 = gốc/folder trên cùng), mỗi cha được cấp 1 "lát" ngang
// tỷ lệ số con → con luôn khởi tạo ngay dưới cha; sau đó relax lò xo CHỈ theo trục X
// (Y giữ nguyên tầng) để edge chéo kéo các node liên quan lại gần nhau.
export type LayoutNode = { id: string; layer: number; size: number }
export type LayoutEdge = { source: string; target: string; hier: boolean; weight?: number }
export type Pos = { x: number; y: number; size: number; layer: number }

const CANVAS_W = 1200
const PAD_X = 60
const MIN_GAP = 40
const MAX_X = (CANVAS_W - PAD_X * 2) / 2

const hash01 = (s: string): number => {
  let h = 5381
  for (let i = 0; i < s.length; i++) { h = (h << 5) + h + s.charCodeAt(i); h |= 0 }
  return (Math.abs(h) % 10000) / 10000
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function treeLayout(nodes: LayoutNode[], edges: LayoutEdge[], layerCount = 4, layerH = 190): Map<string, Pos> {
  const pos = new Map<string, Pos>()
  const layerOf = new Map(nodes.map((n) => [n.id, clamp(n.layer, 0, layerCount - 1)]))

  // hierarchy maps (chỉ edge hier=true quyết định "con nằm dưới cha")
  const children = new Map<string, string[]>()
  const parents = new Map<string, string[]>()
  for (const e of edges) {
    if (!e.hier) continue
    children.set(e.source, [...(children.get(e.source) || []), e.target])
    parents.set(e.target, [...(parents.get(e.target) || []), e.source])
  }

  const byLayer: LayoutNode[][] = Array.from({ length: layerCount }, () => [])
  for (const n of nodes) byLayer[clamp(n.layer, 0, layerCount - 1)].push(n)
  const layerY = (l: number) => l * layerH

  // --- tầng 0: xếp đều theo alphabet ---
  const l0 = [...byLayer[0]].sort((a, b) => a.id.localeCompare(b.id))
  l0.forEach((n, i) => pos.set(n.id, { x: -MAX_X + ((i + 0.5) * (MAX_X * 2)) / l0.length, y: layerY(0), size: n.size, layer: 0 }))

  // --- tầng 1..n: cấp lát ngang tỷ lệ số con của mỗi cha (proportional slices) ---
  for (let L = 1; L < layerCount; L++) {
    const layerNodes = byLayer[L]
    if (!layerNodes.length) continue
    const groups = new Map<string, LayoutNode[]>()
    const orphans: LayoutNode[] = []
    for (const n of layerNodes) {
      // cha "gần nhất đã đặt": ưu tiên cha có layer cao nhất
      let best: string | null = null, bestL = -1
      for (const p of parents.get(n.id) || []) {
        if (!pos.has(p)) continue
        const pl = layerOf.get(p) ?? -1
        if (pl > bestL) { bestL = pl; best = p }
      }
      if (best) groups.set(best, [...(groups.get(best) || []), n])
      else orphans.push(n)
    }
    const parented = layerNodes.length - orphans.length
    const activeParents = [...groups.keys()].sort((a, b) => (pos.get(a)?.x ?? 0) - (pos.get(b)?.x ?? 0))
    const totalW = MAX_X * 2
    const parentedW = parented > 0 ? totalW * (parented / layerNodes.length) : 0
    let curX = -MAX_X
    const place = (list: LayoutNode[], startX: number, w: number) => {
      list.sort((a, b) => a.id.localeCompare(b.id))
      // >4 node → 2-3 hàng lệch Y nhẹ cho đỡ chen (GitNexus row offsets)
      const rows = list.length <= 4 ? 1 : list.length <= 16 ? 2 : 3
      const spread = rows === 1 ? 0 : rows === 2 ? 56 : 96
      list.forEach((n, i) => {
        const row = i % rows
        pos.set(n.id, {
          x: startX + ((Math.floor(i / rows) + 0.5) * w) / Math.ceil(list.length / rows),
          y: layerY(L) - spread / 2 + (rows === 1 ? 0 : (row * spread) / (rows - 1)) + (hash01(n.id) - 0.5) * 16,
          size: n.size, layer: L,
        })
      })
    }
    for (const p of activeParents) {
      const kids = groups.get(p)!
      const w = (kids.length / Math.max(1, parented)) * parentedW
      place(kids, curX, w)
      curX += w
    }
    if (orphans.length) place(orphans, curX, totalW - parentedW || totalW * 0.15)
  }

  // --- kéo cây: con hội tụ về giữa các con + cha trượt về trung bình con (6 vòng) ---
  for (let it = 0; it < 6; it++) {
    const childTarget = new Map<string, { s: number; c: number }>()
    for (const [p, kids] of children) {
      const pp = pos.get(p)
      if (!pp) continue
      const placed = kids.map((k) => pos.get(k)).filter(Boolean) as Pos[]
      if (!placed.length) continue
      const center = placed.reduce((s, k) => s + k.x, 0) / placed.length
      const shift = pp.x - center
      kids.forEach((k) => {
        const kp = pos.get(k)
        if (!kp) return
        const t = childTarget.get(k) || { s: 0, c: 0 }
        t.s += kp.x + shift; t.c++
        childTarget.set(k, t)
      })
    }
    for (const [id, t] of childTarget) {
      const p = pos.get(id)!
      p.x = p.x * 0.45 + (t.s / t.c) * 0.55
    }
    for (const [p, kids] of children) {
      const pp = pos.get(p)
      if (!pp) continue
      const xs = kids.map((k) => pos.get(k)?.x).filter((v): v is number => v !== undefined)
      if (xs.length) pp.x = pp.x * 0.65 + (xs.reduce((a, b) => a + b, 0) / xs.length) * 0.35
    }
  }

  // --- lò xo chỉ-X: edge chéo (hier=false) kéo node liên quan lại gần, neo giữ spread ---
  const anchor = new Map([...pos].map(([id, p]) => [id, p.x]))
  const iters = nodes.length > 3000 ? 4 : 14
  for (let it = 0; it < iters; it++) {
    const dx = new Map<string, number>()
    for (const [id, p] of pos) {
      const a = anchor.get(id) ?? p.x
      const nd = Math.min(1, Math.abs(p.x) / MAX_X)
      dx.set(id, (a - p.x) * (0.05 + nd * nd * 0.1))
    }
    for (const e of edges) {
      const s = pos.get(e.source), t = pos.get(e.target)
      if (!s || !t) continue
      const ddx = t.x - s.x, ddy = t.y - s.y
      const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1
      const rest = (e.hier ? 60 : 85) + Math.abs(s.layer - t.layer) * 40
      const stretch = dist - rest
      if (stretch <= 0) continue
      const w = e.weight ?? (e.hier ? 0.13 : 0.22)
      const f = ((ddx / dist) * stretch * w * 0.08)
      dx.set(e.source, (dx.get(e.source) ?? 0) + f)
      dx.set(e.target, (dx.get(e.target) ?? 0) - f)
    }
    for (const [id, p] of pos) {
      const nd = Math.min(1, Math.abs(p.x) / MAX_X)
      const step = clamp((dx.get(id) ?? 0) / (1 + nd * nd * 4.5), -(18 - nd * 6), 18 - nd * 6)
      p.x = clamp(p.x + step, -MAX_X, MAX_X)
    }
    // giãn cách tối thiểu trong tầng (2 lượt quét trái↔phải)
    for (const layerNodes of byLayer) {
      if (layerNodes.length < 2) continue
      const ids = layerNodes.map((n) => n.id).sort((a, b) => pos.get(a)!.x - pos.get(b)!.x)
      for (let i = 1; i < ids.length; i++) {
        const a = pos.get(ids[i - 1])!, b = pos.get(ids[i])!
        const gap = b.x - a.x, min = Math.max(MIN_GAP * 0.65, (a.size + b.size) * 1.7)
        if (gap < min) { const push = (min - gap) / 2; a.x -= push; b.x += push }
      }
    }
  }

  // recenter + scale mềm về khung
  const xs = [...pos.values()].map((p) => p.x)
  if (xs.length) {
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const half = Math.max(1, (Math.max(...xs) - Math.min(...xs)) / 2)
    const sc = half > MAX_X ? MAX_X / half : 1
    for (const p of pos.values()) p.x = (p.x - cx) * sc
  }
  return pos
}
