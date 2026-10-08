// metrics — build ledger thành token/cost time‑series + throughput.
// Thuần: không đụng engine, không đọc file trực tiếp, chỉ gọi store + recall.
import type { Store } from './store'
import type { Recall } from './recall'
import type { LedgerEntry } from './types'
import { vnDay, vnAlign } from './tz'

// DASH-FIX S4: cacheTok tách cột (kiểu Hermes in·out·cache). inTok = input "tươi"; cacheTok = cache read+creation.
export type MetricsDay = { inTok: number; outTok: number; cacheTok: number; usd: number }
export type MetricsGroup = { usd: number; inTok: number; outTok: number; cacheTok: number; runs: number }

export type Metrics = {
  tokenByDay: Record<string, MetricsDay>
  costByModel: Record<string, MetricsGroup>
  costByAgent: Record<string, MetricsGroup>
  costByProject: Record<string, MetricsGroup>
  costBySource: Record<string, MetricsGroup> // DASH-FIX S4: nguồn đốt (worker/autobuild/bridge/hub/cron/lane/unknown)
  cardThroughput: Record<string, { created: number; done: number }>
  vault: { notes: number; observations: number } | null
  totals: { usd: number; inTok: number; outTok: number; cacheTok: number; runs: number; cards: number }
}

// ── M5 time-series: bucket ledger thành chuỗi token/cost cho sparkline (24h theo giờ, 7d/30d theo ngày).
// Zero-fill bucket rỗng = SỐ THẬT (không có run → 0, KHÔNG bịa). t = mốc bắt đầu bucket (ms; ngày căn nửa đêm VN — S5).
export type SeriesPoint = { t: number; tokens: number; usd: number; runs: number }
export type MetricsSeries = { '24h': SeriesPoint[]; '7d': SeriesPoint[]; '30d': SeriesPoint[] }

const HOUR_MS = 3600_000
const DAY_MS = 86_400_000

export function buildSeries(store: Store, now: number): MetricsSeries {
  const entries = store.readLedger()
  const bucketize = (count: number, span: number): SeriesPoint[] => {
    const align = (t: number) => vnAlign(t, span) // S5: ngày căn nửa đêm VN (giờ: 7h chia hết → giữ nguyên)
    const end = align(now)                  // bucket hiện tại (mới nhất)
    const points: SeriesPoint[] = []
    const idx = new Map<number, SeriesPoint>()
    for (let i = count - 1; i >= 0; i--) {  // cũ → mới
      const start = end - i * span
      const p: SeriesPoint = { t: start, tokens: 0, usd: 0, runs: 0 }
      points.push(p); idx.set(start, p)
    }
    for (const e of entries) {
      const p = idx.get(align(e.ts))
      if (p) { p.tokens += e.inTok + e.outTok + (e.cacheTok || 0); p.usd += e.usd; p.runs++ } // S4: token gồm cache → khớp guard.used
    }
    return points
  }
  return {
    '24h': bucketize(24, HOUR_MS),
    '7d': bucketize(7, DAY_MS),
    '30d': bucketize(30, DAY_MS),
  }
}

/** Model thực tế 1 run, replica logic engine.ts:368. */
function resolveModel(card: { modelOverride?: string }, personaModel: string): string {
  // 'laneModel' = dùng model mặc định của persona, giống engine (không đè)
  if (!card.modelOverride || card.modelOverride === 'laneModel') return personaModel
  // không hạ cấp nếu persona gốc là opus
  if (personaModel === 'opus') return 'opus'
  return card.modelOverride
}

export function buildMetrics(store: Store, recall?: Recall | null): Metrics {
  const entries = store.readLedger()

  const tokenByDay: Record<string, MetricsDay> = {}
  const costByModel: Record<string, MetricsGroup> = {}
  const costByAgent: Record<string, MetricsGroup> = {}
  const costByProject: Record<string, MetricsGroup> = {}
  const costBySource: Record<string, MetricsGroup> = {}

  // S4: gom 1 entry vào 1 group (tạo nếu chưa có) — đủ in/out/cache cho cột Hermes.
  const add = (bag: Record<string, MetricsGroup>, key: string, e: LedgerEntry) => {
    let g = bag[key]
    if (!g) { g = { usd: 0, inTok: 0, outTok: 0, cacheTok: 0, runs: 0 }; bag[key] = g }
    g.usd += e.usd; g.inTok += e.inTok; g.outTok += e.outTok; g.cacheTok += (e.cacheTok || 0); g.runs++
  }

  for (const e of entries) {
    const day = vnDay(e.ts) // S5: ngày theo VN (UTC+7), khớp token-guard/coordinator

    // tokenByDay
    let d = tokenByDay[day]
    if (!d) { d = { inTok: 0, outTok: 0, cacheTok: 0, usd: 0 }; tokenByDay[day] = d }
    d.inTok += e.inTok
    d.outTok += e.outTok
    d.cacheTok += (e.cacheTok || 0)
    d.usd += e.usd

    // tra cứu card để lấy projectId + modelOverride (cho dòng worker cũ)
    const card = store.getCard(e.cardId)
    const projectId = card ? (card.projectId || 'unknown') : 'unknown'

    // S4: ưu tiên model GHI THẲNG trong entry (Round-1+); dòng cũ thiếu → resolve từ persona+card.
    let model = e.model && e.model !== 'unknown' ? e.model : ''
    if (!model) {
      const personaObj = store.personas.get(e.persona)
      model = personaObj ? resolveModel(card ?? { modelOverride: undefined }, personaObj.model) : 'unknown'
    }

    add(costByModel, model, e)
    add(costByAgent, e.persona, e)          // key = persona id (worker) hoặc source (đường ngoài, persona=source)
    add(costByProject, projectId, e)
    add(costBySource, e.source || 'worker', e) // nguồn đốt
  }

  // ── cardThroughput: từ card.history events ──
  const cardThroughput: Record<string, { created: number; done: number }> = {}
  for (const c of store.listCards()) {
    for (const h of c.history) {
      const day = vnDay(h.ts) // S5: VN
      let td = cardThroughput[day]
      if (!td) { td = { created: 0, done: 0 }; cardThroughput[day] = td }
      if (h.event === 'created' || h.event === 'created-backlog') td.created++
      if (h.event === 'done') td.done++
    }
  }

  // totals
  let totalUsd = 0, totalInTok = 0, totalOutTok = 0, totalCacheTok = 0, totalRuns = 0
  for (const g of Object.values(costByModel)) {
    totalUsd += g.usd; totalInTok += g.inTok; totalOutTok += g.outTok; totalCacheTok += g.cacheTok; totalRuns += g.runs
  }

  // vault
  const vault = recall
    ? { notes: recall.stats().total, observations: recall.stats().observations }
    : null

  return {
    tokenByDay,
    costByModel,
    costByAgent,
    costByProject,
    costBySource,
    cardThroughput,
    vault,
    totals: {
      usd: Math.round(totalUsd * 1e6) / 1e6,
      inTok: totalInTok,
      outTok: totalOutTok,
      cacheTok: totalCacheTok,
      runs: totalRuns,
      cards: store.listCards().length,
    },
  }
}
