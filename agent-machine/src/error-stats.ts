// error-stats — phân loại + đếm lỗi agent từ turn-log.jsonl.
// Thuần: đọc JSONL (try/catch → []), classify theo rule tất định, gom theo category/agent/model.
// KHÔNG đụng engine loop. Resolve model qua store.personas như metrics.ts.
import fs from 'node:fs'
import path from 'node:path'
import type { Store } from './store'
import type { Decision } from './types'

// ── Category ──
export type ErrorCategory =
  | 'llm-error'      // hạ tầng: callLLMRaw throw (timeout/rate-limit/khác)
  | 'out-of-turns'   // hết maxTurns, không salvage được gì
  | 'salvage'        // hết maxTurns nhưng suy ra được outcome từ report
  | 'build-fail'     // outcome fail/rework do build/tsc/compile
  | 'spec-fail'      // outcome fail/rework do test/spec/assert
  | 'loop'           // outcome fail/rework do lặp
  | 'wrong-output'   // outcome fail/rework do parse/json/format sai
  | 'other'          // outcome fail/rework không khớp keyword nào

export const ERROR_CATEGORIES: ErrorCategory[] = [
  'llm-error', 'out-of-turns', 'salvage', 'build-fail', 'spec-fail', 'loop', 'wrong-output', 'other',
]

// ── Keyword phân nhóm reason (match trên motive+outcome, thường mong manh → giữ tập trung, fallback 'other') ──
const KW_BUILD = ['build', 'tsc', 'compile', 'typecheck', 'biên dịch']
const KW_SPEC = ['test', 'spec', 'assert', 'kiểm thử']
const KW_LOOP = ['loop', 'lặp', 'vòng lặp']
const KW_WRONG = ['parse', 'json', 'format', 'định dạng']

// Decision được coi là outcome-thất-bại (tất định, không đoán qua text).
const FAIL_DECISIONS: ReadonlySet<Decision> = new Set<Decision>(['fail', 'rework'])

// ── Shape record sau parse (narrow từ unknown) ──
type ParsedTurn = {
  agent: string
  model?: string  // undefined/'' nếu dòng cũ thiếu field → consumer fallback suy từ persona. classifyTurn không dùng.
  action: string
  motive: string
  outcome: string
  decision?: Decision
}

function asStr(v: unknown): string { return typeof v === 'string' ? v : '' }

function parseTurn(line: string): ParsedTurn | null {
  let raw: unknown
  try { raw = JSON.parse(line) } catch { return null }
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const action = asStr(r.action)
  if (!action) return null
  const decision = typeof r.decision === 'string' ? (r.decision as Decision) : undefined
  return { agent: asStr(r.agent) || 'unknown', model: asStr(r.model), action, motive: asStr(r.motive), outcome: asStr(r.outcome), decision }
}

function hasAny(haystack: string, words: string[]): boolean {
  return words.some((w) => haystack.includes(w))
}

/** Sub-nhóm 1 outcome-lỗi theo keyword reason. `orNull`: dòng cũ thiếu decision → chỉ tính khi khớp KW
 *  cụ thể (tránh đếm nhầm outcome thành công thành 'other'); record có decision FAIL → fallback 'other'. */
function subclassify(motive: string, outcome: string, orNull: boolean): ErrorCategory | null {
  const hay = (motive + ' ' + outcome).toLowerCase()
  if (hasAny(hay, KW_BUILD)) return 'build-fail'
  if (hasAny(hay, KW_SPEC)) return 'spec-fail'
  if (hasAny(hay, KW_LOOP)) return 'loop'
  if (hasAny(hay, KW_WRONG)) return 'wrong-output'
  return orNull ? null : 'other'
}

/** Phân loại 1 record → category nếu là lỗi, null nếu không phải lỗi (tool_call/text/outcome thành công). */
export function classifyTurn(t: ParsedTurn): ErrorCategory | null {
  // 1. Hạ tầng LLM lỗi.
  if (t.action === 'error') return 'llm-error'
  if (t.action !== 'outcome') return null

  // 2-3. Terminal "hết N turn" — format CỐ ĐỊNH do LaneRunner ghi (lane-runner.ts:136):
  // `hết <N> turn — salvage|không ra gì`. Khớp regex chặt để KHÔNG đếm nhầm motive free-text
  // của outcome thành công (lane-runner.ts:122 ghi motive = nguyên text agent, có thể bắt đầu "hết ").
  const term = /^hết \d+ turn — (salvage|không ra gì)$/.exec(t.motive)
  if (term) return term[1] === 'salvage' ? 'salvage' : 'out-of-turns'

  // 4. Có decision (log mới): tin tất định. Thành công (advance/done/delegate/needs_decision) → không tính;
  //    fail/rework → sub-nhóm theo keyword (fallback 'other').
  if (t.decision) {
    return FAIL_DECISIONS.has(t.decision) ? subclassify(t.motive, t.outcome, false) : null
  }

  // 5. Thiếu decision (dòng JSONL cũ, tương thích ngược): không gate được → best-effort theo keyword,
  //    chỉ tính khi khớp KW lỗi cụ thể để tránh nuốt nhầm outcome thành công.
  return subclassify(t.motive, t.outcome, true)
}

function emptyByCategory(): Record<ErrorCategory, number> {
  const o = {} as Record<ErrorCategory, number>
  for (const c of ERROR_CATEGORIES) o[c] = 0
  return o
}

export type ErrorStats = {
  total: number
  byCategory: { category: ErrorCategory; count: number }[]
  byAgent: { agent: string; count: number; byCategory: Record<ErrorCategory, number> }[]
  byModel: { model: string; count: number; byCategory: Record<ErrorCategory, number> }[]
  topCategory: ErrorCategory | null
  /** Giới hạn coverage: chỉ LaneRunner emit turn-log (runner claude thật chưa ghi). */
  scope: string
}

function readTurnLog(dir: string): string[] {
  try {
    const raw = fs.readFileSync(path.join(dir, 'turn-log.jsonl'), 'utf8').trim()
    return raw ? raw.split('\n').filter(Boolean) : []
  } catch { return [] }
}

/**
 * Đọc turn-log.jsonl, phân nhóm lỗi, đếm theo agent + model.
 * @param logDir thư mục chứa turn-log.jsonl (mặc định env AM_TURNS_LOG).
 */
export function buildErrorStats(store: Store, logDir?: string): ErrorStats {
  const dir = logDir ?? process.env.AM_TURNS_LOG ?? ''
  const lines = dir ? readTurnLog(dir) : []

  const byCategoryCount = emptyByCategory()
  const agentMap = new Map<string, Record<ErrorCategory, number>>()
  const modelMap = new Map<string, Record<ErrorCategory, number>>()
  let total = 0

  for (const line of lines) {
    const t = parseTurn(line)
    if (!t) continue
    const cat = classifyTurn(t)
    if (!cat) continue
    total++
    byCategoryCount[cat]++

    let ag = agentMap.get(t.agent)
    if (!ag) { ag = emptyByCategory(); agentMap.set(t.agent, ag) }
    ag[cat]++

    // Model THỰC chạy đã ghi tại nguồn (turn-log.model) → đọc thẳng, KHÔNG suy lại từ config
    // (vì TokenGuard SOFT có thể hạ cấp ≠ persona.laneModel). Dòng cũ thiếu field → fallback persona.
    // Dùng `||` (truthy) thay `??`: laneModel='' phải rơi xuống tier model, không đẻ nhãn rỗng.
    const p = store.personas.get(t.agent)
    const model = t.model || p?.laneModel || p?.model || 'unknown'
    let md = modelMap.get(model)
    if (!md) { md = emptyByCategory(); modelMap.set(model, md) }
    md[cat]++
  }

  const sum = (rec: Record<ErrorCategory, number>) => ERROR_CATEGORIES.reduce((s, c) => s + rec[c], 0)

  const byCategory = ERROR_CATEGORIES
    .map((category) => ({ category, count: byCategoryCount[category] }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)

  const byAgent = [...agentMap.entries()]
    .map(([agent, byCat]) => ({ agent, count: sum(byCat), byCategory: byCat }))
    .sort((a, b) => b.count - a.count)

  const byModel = [...modelMap.entries()]
    .map(([model, byCat]) => ({ model, count: sum(byCat), byCategory: byCat }))
    .sort((a, b) => b.count - a.count)

  return {
    total,
    byCategory,
    byAgent,
    byModel,
    topCategory: byCategory.length ? byCategory[0].category : null,
    scope: 'lane = per-turn ghi mọi turn; claude = 1 record outcome/run (per-turn không khả dụng vì claude -p mờ)',
  }
}
