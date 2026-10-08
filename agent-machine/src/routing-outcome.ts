// routing-outcome.ts -- BH-D meta-learning: track routing feedback.
import fs from 'node:fs'
import path from 'node:path'

export interface RoutingOutcome {
  ts: number
  model: string
  rating: 'good' | 'bad'
  taskType?: string
  comment?: string
  convId?: string
}

const OUTCOMES_REL = path.join('Brain', 'routing-outcomes.jsonl')

/** Append one outcome to vault. Best-effort: catches errors silently. */
export function appendOutcome(vaultDir: string, outcome: RoutingOutcome): void {
  try {
    const file = path.join(vaultDir, OUTCOMES_REL)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(outcome) + '\n')
  } catch {
    // best-effort
  }
}

/** Read and parse all JSONL. Returns [] on error or missing file. */
export function readOutcomes(vaultDir: string): RoutingOutcome[] {
  try {
    const file = path.join(vaultDir, OUTCOMES_REL)
    const raw = fs.readFileSync(file, 'utf8').trim()
    if (!raw) return []
    const results: RoutingOutcome[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try { results.push(JSON.parse(line) as RoutingOutcome) } catch { /* skip bad line */ }
    }
    return results
  } catch {
    return []
  }
}

export type OutcomeStats = {
  model: string
  good: number
  bad: number
  total: number
  score: number  // % good, 0-100
}

/** Cần ít nhất ngần này feedback trước khi học/override head hardcode (chống thrash khi data ít). */
export const MIN_SAMPLES = 4
/** best phải hơn head ít nhất ngần này % mới override (chống đổi vì nhiễu). */
export const OVERRIDE_MARGIN = 10

export type LearnedPick = { modelKey: string; learned: boolean; reason?: string }

/**
 * BH-D — chọn model THẬT từ outcome đã học, thay vì luôn lấy con đầu bảng (hardcode).
 * candidates = ROUTE_TABLE[role] (thứ tự ưu tiên gốc). stats = groupByModel(readOutcomes()).
 * Quy tắc an toàn:
 *  - Mặc định = candidates[0] (head hardcode) khi chưa đủ data.
 *  - Chỉ override nếu có candidate khác đủ MIN_SAMPLES VÀ (head ít data HOẶC best.score ≥ head.score + margin).
 *  - Tiebreak theo thứ tự bảng gốc (index nhỏ = ưu tiên).
 */
export function pickLearnedModel(candidates: string[], stats: OutcomeStats[], opts: { minSamples?: number; margin?: number } = {}): LearnedPick {
  const head = candidates[0]
  if (!candidates.length) return { modelKey: head, learned: false }
  const min = opts.minSamples ?? MIN_SAMPLES
  const margin = opts.margin ?? OVERRIDE_MARGIN
  const byModel = new Map(stats.map((s) => [s.model, s]))
  const ranked = candidates
    .map((m, i) => ({ m, i, s: byModel.get(m) }))
    .filter((x) => x.s && x.s.total >= min)
    .sort((a, b) => (b.s!.score - a.s!.score) || (a.i - b.i))
  if (!ranked.length) return { modelKey: head, learned: false }
  const best = ranked[0]
  if (best.m === head) return { modelKey: head, learned: false } // học chỉ xác nhận head → không tính override
  const headStats = byModel.get(head)
  if (!headStats || headStats.total < min || best.s!.score >= headStats.score + margin) {
    return { modelKey: best.m, learned: true, reason: `learned: ${best.m} ${best.s!.score}% (${best.s!.good}/${best.s!.total}) > head ${head} ${headStats ? headStats.score + '%' : 'no-data'}` }
  }
  return { modelKey: head, learned: false }
}

/** Group by model, compute score = % good. Sorted by total desc. */
export function groupByModel(outcomes: RoutingOutcome[]): OutcomeStats[] {
  const map = new Map<string, { good: number; bad: number }>()
  for (const o of outcomes) {
    let entry = map.get(o.model)
    if (!entry) { entry = { good: 0, bad: 0 }; map.set(o.model, entry) }
    if (o.rating === 'good') entry.good++
    else entry.bad++
  }
  return [...map.entries()]
    .map(([model, { good, bad }]) => {
      const total = good + bad
      const score = total > 0 ? Math.round((good / total) * 100) : 0
      return { model, good, bad, total, score }
    })
    .sort((a, b) => b.total - a.total)
}
