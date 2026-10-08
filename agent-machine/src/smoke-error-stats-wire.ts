// Wire smoke (T3a) — chứng minh CHUỖI SỐNG: coordinator HTTP GET /error-stats.
// Khác smoke-error-stats (test buildErrorStats thuần): đây test ĐIỂM NỐI HTTP +
// contract shape mà FE (ErrorStatsData) trông đợi. MockRunner, không đốt token.
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import { startCoordinator } from './coordinator'
import type { Persona } from './types'
import type { ErrorCategory } from './error-stats'
import { ERROR_CATEGORIES } from './error-stats'

let pass = 0
let fail = 0
const check = (n: string, c: boolean, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${e}`) } }
const sleep = (ms: number) => new Promise((s) => setTimeout(s, ms))

// Port cố định riêng (KHÔNG đọc AM_PORT — env đó có thể trỏ coordinator thật đang chạy → EADDRINUSE).
const PORT = 8795
const URL = `http://127.0.0.1:${PORT}`
const TOKEN = 'wire-token'
const tmp = (n: string) => { const d = path.join(process.cwd(), '.smoke', n); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); return d }

function persona(id: string, laneModel: string): Persona {
  return { id, name: id, model: 'sonnet', laneModel, systemPrompt: '', allowedTools: [] }
}

const LINES = [
  { agent: 'builder', action: 'error', motive: 'callLLMRaw thất bại', outcome: 'timeout', model: 'executor' },
  { agent: 'builder', action: 'outcome', motive: 'hết 16 turn — không ra gì', outcome: 'kẹt', decision: 'needs_decision', model: 'executor' },
  { agent: 'builder', action: 'outcome', motive: 'sửa xong', outcome: 'tsc compile lỗi', decision: 'fail', model: 'executor' },
  { agent: 'reviewer', action: 'outcome', motive: 'review', outcome: 'json parse sai', decision: 'rework', model: 'opus' },
  // outcome thành công — KHÔNG được tính
  { agent: 'builder', action: 'outcome', motive: 'xong', outcome: 'ok', decision: 'advance', model: 'executor' },
]

// Keys mà FE ErrorStatsData (api.ts) trông đợi từ endpoint thô (hub bọc thêm `configured`).
const REQUIRED_KEYS = ['total', 'byCategory', 'byAgent', 'byModel', 'topCategory', 'scope']

async function main() {
  console.log('🧪 wire smoke — GET /error-stats end-to-end (coordinator HTTP)')

  // turn-log nằm ở dir cục bộ; endpoint đọc qua process.env.AM_TURNS_LOG (giống prod/CLI).
  const logDir = tmp('errwire-log')
  fs.writeFileSync(path.join(logDir, 'turn-log.jsonl'), LINES.map((l) => JSON.stringify(l)).join('\n') + '\n')
  process.env.AM_TURNS_LOG = logDir

  const store = new Store(tmp('errwire-state'))
  store.registerPersona(persona('builder', 'executor'))
  store.registerPersona(persona('reviewer', 'opus'))

  const engine = new Engine(store, new MockRunner({}), new Budget({ windowMs: 5 * 3600e3, capUsd: 5 }), { perCardMaxUsd: 5 })
  const co = startCoordinator(engine, store, PORT, { token: TOKEN })
  await sleep(150)

  // 1. auth: thiếu token → 401 (route phải nằm trong vùng bảo vệ token)
  const bad = await fetch(URL + '/error-stats')
  check('thiếu token → 401', bad.status === 401, `(got ${bad.status})`)

  // 2. có token → 200 + JSON
  const res = await fetch(URL + '/error-stats', { headers: { 'x-worker-token': TOKEN } })
  check('có token → 200', res.status === 200, `(got ${res.status})`)
  const body = await res.json() as Record<string, unknown>

  // 3. contract: đủ mọi key FE cần, KHÔNG thiếu
  for (const k of REQUIRED_KEYS) check(`có key '${k}'`, k in body, `(keys: ${Object.keys(body).join(',')})`)

  // 4. endpoint thô KHÔNG tự gắn `configured` (hub proxy mới là chỗ bọc) — tránh double-wrap
  check("endpoint thô không có 'configured'", !('configured' in body), `(got ${JSON.stringify(body['configured'])})`)

  // 5. số liệu đúng: 4 lỗi (advance không tính)
  check('total = 4', body.total === 4, `(got ${body.total})`)
  check('topCategory không null', body.topCategory !== null)

  // 6. byCategory đúng kiểu mảng {category,count}
  const byCat = body.byCategory as { category: ErrorCategory; count: number }[]
  check('byCategory là mảng', Array.isArray(byCat))
  check('byCategory phần tử có {category,count}', byCat.every((c) => typeof c.category === 'string' && typeof c.count === 'number'))

  // 7. byAgent/byModel.byCategory = Record ĐỦ 8 ErrorCategory (FE khai Record<ErrorCategory,number>)
  const byAgent = body.byAgent as { agent: string; count: number; byCategory: Record<ErrorCategory, number> }[]
  const builderRow = byAgent.find((a) => a.agent === 'builder')
  check('byAgent có builder', !!builderRow, `(agents: ${byAgent.map((a) => a.agent).join(',')})`)
  if (builderRow) check('byAgent.byCategory đủ 8 key', ERROR_CATEGORIES.every((c) => c in builderRow.byCategory), `(keys: ${Object.keys(builderRow.byCategory).join(',')})`)

  const byModel = body.byModel as { model: string; count: number; byCategory: Record<ErrorCategory, number> }[]
  check('byModel resolve model thật (executor + opus)', byModel.some((m) => m.model === 'executor') && byModel.some((m) => m.model === 'opus'), `(models: ${byModel.map((m) => m.model).join(',')})`)

  // 8. AM_TURNS_LOG trỏ dir KHÔNG có file → total 0, topCategory null, KHÔNG crash (prod tách máy)
  process.env.AM_TURNS_LOG = tmp('errwire-empty')
  const empty = await (await fetch(URL + '/error-stats', { headers: { 'x-worker-token': TOKEN } })).json() as Record<string, unknown>
  check('dir trống → total 0', empty.total === 0, `(got ${empty.total})`)
  check('dir trống → topCategory null', empty.topCategory === null)
  check('dir trống → vẫn đủ key (empty-state FE không vỡ)', REQUIRED_KEYS.every((k) => k in empty))

  co.stop()
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
