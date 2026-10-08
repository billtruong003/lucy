// Mô phỏng lực LIVE kiểu GitNexus — port từ gitnexus-web/src/hooks/useSigma.ts (vòng tree layout,
// PolyForm Noncommercial — chỉ dùng nội bộ hub, KHÔNG đem vào sản phẩm bán).
// Khác treeLayout.ts (tính 1 lần, tĩnh): TreeSim chạy TỪNG FRAME qua step(ts) — node trôi và tự
// lắng như GitNexus thật. Caller giữ rAF loop, đọc node.x/y sau mỗi step để vẽ.
//
// Lực mỗi sub-step (dtScale=0.6):
//   1. layer gravity: kéo về targetY = tâm tầng + yBias·BAND_HALF (bias theo hướng kết nối lên/xuống)
//   2. lò xo X thuần theo |dx| (hier rest=0 → con chui thẳng dưới cha; cross rest=60, weight cap 0.1)
//   3. lò xo Y yếu (0.008) chống giãn cực đại xuyên tầng
//   4. repulsion 2D sort-theo-X early-exit (same-layer 100 / cross 28), skip khi >5000 node
//   5. spread force dàn đều mật độ trong tầng (0.003), skip khi >5000 node
//   Tích phân: resist biên (X: 1+n²·4, Y: 1+n²·10), damping, deadzone, cap vận tốc.
//   Dừng: ≥24 frame ổn định (maxV/avgV/activeNodes dưới ngưỡng) hoặc quá maxDuration.

export type PhysNode = { id: string; layer: number; size: number; x: number; y: number }
export type PhysEdge = { source: string; target: string; hier: boolean; weight?: number }

const MAX_X = 540
const REPULSION_RANGE = 130
const TARGET_FRAME_MS = 32
const MIN_DURATION = 1500
const STABILITY_FRAMES = 24
const FORCE_DEADZONE = 0.005
const VELOCITY_DEADZONE = 0.01
const LAYER_GRAVITY = 0.06
const BAND_HALF = 55
const BOUNDARY_RESISTANCE = 10
const SPREAD_STRENGTH = 0.003
const DT = 0.6

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export class TreeSim {
  nodes: PhysNode[]
  private edges: PhysEdge[]
  private byId = new Map<string, PhysNode>()
  private centerY = new Map<number, number>()
  private yBias = new Map<string, number>()
  private vx = new Map<string, number>()
  private vy = new Map<string, number>()
  private t0: number | null = null
  private lastTick: number | null = null
  private acc = 0
  private stable = 0
  done = false
  // tuning thích ứng theo cỡ graph (GitNexus: large >5000, medium >1500)
  private damping: number
  private capX: number
  private capY: number
  private maxSimSteps: number
  private maxDuration: number
  private stopMaxV: number
  private stopAvgV: number
  private stopActiveFrac: number
  private stopStableFrames: number
  private useRepulsion: boolean
  private useSpread: boolean

  constructor(nodes: PhysNode[], edges: PhysEdge[], layerH = 190) {
    this.nodes = nodes
    this.edges = edges
    for (const n of nodes) this.byId.set(n.id, n)
    const layers = new Set(nodes.map((n) => n.layer))
    for (const l of layers) this.centerY.set(l, l * layerH)

    const large = nodes.length > 5000
    const medium = nodes.length > 1500
    this.useRepulsion = !large
    this.useSpread = !large
    this.damping = large ? 0.58 : 0.62
    this.capX = large ? 12 : medium ? 6 : 3
    this.capY = large ? 6 : medium ? 3 : 2
    this.maxSimSteps = large ? 1 : 2
    this.maxDuration = large ? 30000 : medium ? 24000 : 18000
    this.stopMaxV = large ? 0.05 : 0.022
    this.stopAvgV = large ? 0.03 : 0.016
    this.stopActiveFrac = large ? 0.02 : 0.008
    this.stopStableFrames = large ? 20 : STABILITY_FRAMES

    // yBias ∈ [-0.55, +0.55]: node chỉ nối LÊN tầng trên → mép trên band; chỉ nối XUỐNG → mép dưới
    const above = new Map<string, number>()
    const below = new Map<string, number>()
    const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) || 0) + 1)
    for (const e of edges) {
      const s = this.byId.get(e.source), t = this.byId.get(e.target)
      if (!s || !t) continue
      if (t.layer < s.layer) bump(above, s.id); else if (t.layer > s.layer) bump(below, s.id)
      if (s.layer < t.layer) bump(above, t.id); else if (s.layer > t.layer) bump(below, t.id)
    }
    for (const n of nodes) {
      const a = above.get(n.id) || 0, b = below.get(n.id) || 0
      this.yBias.set(n.id, a + b > 0 ? ((a - b) / (a + b)) * 0.55 : 0)
      // pre-position Y về vị trí ưa thích → hội tụ nhanh hơn (GitNexus làm y hệt)
      const cy = this.centerY.get(n.layer) ?? n.y
      n.y = cy + (this.yBias.get(n.id) || 0) * BAND_HALF * 0.6
      this.vx.set(n.id, 0); this.vy.set(n.id, 0)
    }
  }

  /** Chạy physics cho frame hiện tại. Trả về true nếu có node dịch chuyển (cần vẽ lại). */
  step(ts: number): boolean {
    if (this.done) return false
    if (this.t0 === null) this.t0 = ts
    const delta = this.lastTick === null ? TARGET_FRAME_MS : clamp(ts - this.lastTick, 8, 64)
    this.lastTick = ts
    this.acc = Math.min(TARGET_FRAME_MS * 3, this.acc + delta)
    if (this.acc < TARGET_FRAME_MS) return false
    const steps = Math.min(this.maxSimSteps, Math.floor(this.acc / TARGET_FRAME_MS))
    this.acc -= steps * TARGET_FRAME_MS

    let totalV = 0, maxV = 0, active = 0
    for (let s = 0; s < steps; s++) {
      const fx = new Map<string, number>()
      const fy = new Map<string, number>()

      // 1. layer gravity + yBias
      for (const n of this.nodes) {
        const cy = this.centerY.get(n.layer) ?? n.y
        const targetY = cy + (this.yBias.get(n.id) || 0) * BAND_HALF
        fx.set(n.id, 0)
        fy.set(n.id, (targetY - n.y) * LAYER_GRAVITY * DT)
      }

      // 2. lò xo X thuần |dx| + 3. lò xo Y yếu
      for (const e of this.edges) {
        const a = this.byId.get(e.source), b = this.byId.get(e.target)
        if (!a || !b) continue
        const w = e.weight ?? (e.hier ? 0.11 : 0.18)
        const dx = b.x - a.x
        const xRest = e.hier ? 0 : 60
        const xStretch = Math.abs(dx) - xRest
        if (xStretch > 0) {
          const xW = e.hier ? w : Math.min(w, 0.1)
          const f = Math.sign(dx) * xStretch * xW * 0.3 * DT
          fx.set(e.source, fx.get(e.source)! + f)
          fx.set(e.target, fx.get(e.target)! - f)
        }
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const gap = Math.abs(b.layer - a.layer)
        const yRest = (e.hier ? 70 : 95) + gap * (e.hier ? 28 : 36)
        const yStretch = dist - yRest
        if (yStretch > 0) {
          const f = (dy / dist) * yStretch * w * 0.008 * DT
          fy.set(e.source, fy.get(e.source)! + f)
          fy.set(e.target, fy.get(e.target)! - f)
        }
      }

      // 4. repulsion 2D — sort theo X, early-exit khi dx > range
      if (this.useRepulsion) {
        const list = [...this.nodes].sort((a, b) => a.x - b.x)
        for (let i = 0; i < list.length; i++) {
          const A = list[i]
          for (let j = i + 1; j < list.length; j++) {
            const B = list[j]
            const dx = B.x - A.x
            if (dx > REPULSION_RANGE) break
            const dy = B.y - A.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            if (dist > REPULSION_RANGE) continue
            const sameLayer = A.layer === B.layer
            const strength = sameLayer ? 100 : 28
            const minGap = Math.max(28, (A.size + B.size) * 1.8)
            let rep = (1 / (dist + 8) - 1 / (REPULSION_RANGE + 8)) * strength * DT
            if (dist < minGap && sameLayer) rep += (minGap - dist) * 0.1 * DT
            if (rep <= 0) continue
            const rx = (dx / dist) * rep, ry = (dy / dist) * rep
            fx.set(A.id, fx.get(A.id)! - rx); fy.set(A.id, fy.get(A.id)! - ry)
            fx.set(B.id, fx.get(B.id)! + rx); fy.set(B.id, fy.get(B.id)! + ry)
          }
        }
      }

      // 5. spread — dàn đều mật độ trong tầng
      if (this.useSpread) {
        const byLayer = new Map<number, PhysNode[]>()
        for (const n of this.nodes) {
          if (!byLayer.has(n.layer)) byLayer.set(n.layer, [])
          byLayer.get(n.layer)!.push(n)
        }
        for (const [, ns] of byLayer) {
          if (ns.length < 2) continue
          ns.sort((a, b) => a.x - b.x)
          const spacing = (MAX_X * 2) / ns.length
          ns.forEach((n, i) => {
            const idealX = -MAX_X + (i + 0.5) * spacing
            fx.set(n.id, fx.get(n.id)! + (idealX - n.x) * SPREAD_STRENGTH * DT)
          })
        }
      }

      // tích phân vận tốc + resist biên + deadzone + clamp
      totalV = 0; maxV = 0; active = 0
      for (const n of this.nodes) {
        const f_x = fx.get(n.id) ?? 0, f_y = fy.get(n.id) ?? 0
        const nx = Math.min(1, Math.abs(n.x) / MAX_X)
        const resistX = 1 + nx * nx * 4
        const cy = this.centerY.get(n.layer) ?? n.y
        const ny = Math.min(1, Math.abs(n.y - cy) / BAND_HALF)
        const resistY = 1 + ny * ny * BOUNDARY_RESISTANCE
        const rvx = ((this.vx.get(n.id) ?? 0) + f_x / resistX) * this.damping
        const rvy = ((this.vy.get(n.id) ?? 0) + f_y / resistY) * this.damping
        const nvx = Math.abs(f_x) < FORCE_DEADZONE && Math.abs(rvx) < VELOCITY_DEADZONE ? 0 : clamp(rvx, -this.capX, this.capX)
        const nvy = Math.abs(f_y) < FORCE_DEADZONE && Math.abs(rvy) < VELOCITY_DEADZONE ? 0 : clamp(rvy, -this.capY, this.capY)
        this.vx.set(n.id, nvx); this.vy.set(n.id, nvy)
        const speed = Math.sqrt(nvx * nvx + nvy * nvy)
        totalV += speed
        maxV = Math.max(maxV, speed)
        if (speed > VELOCITY_DEADZONE || Math.abs(f_x) > FORCE_DEADZONE || Math.abs(f_y) > FORCE_DEADZONE) active++
        n.x = clamp(n.x + nvx, -MAX_X, MAX_X)
        n.y = clamp(n.y + nvy, cy - BAND_HALF, cy + BAND_HALF)
      }
    }

    // điều kiện dừng: ổn định liên tiếp hoặc quá giờ
    const avgV = totalV / Math.max(1, this.nodes.length)
    const elapsed = ts - (this.t0 ?? ts)
    if (elapsed >= MIN_DURATION && maxV < this.stopMaxV && avgV < this.stopAvgV
      && active <= Math.max(2, Math.floor(this.nodes.length * this.stopActiveFrac))) this.stable++
    else this.stable = 0
    if (this.stable >= this.stopStableFrames || elapsed >= this.maxDuration) this.done = true
    return true
  }
}
