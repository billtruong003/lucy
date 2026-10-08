// Smoke test error-stats — dựng turn-log.jsonl giả đủ category, assert đếm đúng
// + outcome thành công KHÔNG bị tính. Theo mẫu smoke-metrics.ts.
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { buildErrorStats, classifyTurn } from './error-stats'
import type { Persona } from './types'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}
const tmp = (n: string) => { const d = path.join(process.cwd(), '.smoke', n); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); return d }

// Persona tối thiểu để resolve model (laneModel = model thực chạy lane).
function persona(id: string, laneModel: string): Persona {
  return { id, name: id, model: 'sonnet', laneModel, systemPrompt: '', allowedTools: [] }
}

// Mỗi dòng = 1 TurnRecord JSONL.
const LINES = [
  // builder (model executor)
  { agent: 'builder', task: 'c1', stage: 's', motive: 'callLLMRaw thất bại', action: 'error', outcome: 'timeout', turnCount: 0, token: 0 },
  { agent: 'builder', task: 'c1', stage: 's', motive: 'hết 16 turn — không ra gì', action: 'outcome', outcome: 'kẹt', turnCount: 16, token: 0, decision: 'needs_decision' },
  { agent: 'builder', task: 'c1', stage: 's', motive: 'hết 16 turn — salvage', action: 'outcome', outcome: 'suy ra', turnCount: 16, token: 0, decision: 'advance' },
  { agent: 'builder', task: 'c1', stage: 's', motive: 'sửa xong', action: 'outcome', outcome: 'tsc compile lỗi type', turnCount: 3, token: 10, decision: 'fail' },
  { agent: 'builder', task: 'c1', stage: 's', motive: 'chạy test', action: 'outcome', outcome: 'spec assert fail', turnCount: 4, token: 10, decision: 'rework' },
  // record KHÔNG phải lỗi — outcome thành công + tool_call + text
  { agent: 'builder', task: 'c1', stage: 's', motive: 'xong', action: 'outcome', outcome: 'ok', turnCount: 5, token: 10, decision: 'advance' },
  { agent: 'builder', task: 'c1', stage: 's', motive: 'dùng read_file', action: 'tool_call', outcome: '', turnCount: 1, token: 10 },
  { agent: 'builder', task: 'c1', stage: 's', motive: 'suy nghĩ', action: 'text', outcome: '', turnCount: 2, token: 10 },
  // reviewer (model opus) — 1 lỗi khác model
  { agent: 'reviewer', task: 'c2', stage: 's', motive: 'review', action: 'outcome', outcome: 'json parse sai format', turnCount: 1, token: 5, decision: 'rework' },
]

async function main() {
  console.log('🧪 smoke:error-stats — buildErrorStats() phân loại đúng')
  const dir = tmp('errstats')
  fs.writeFileSync(path.join(dir, 'turn-log.jsonl'), LINES.map((l) => JSON.stringify(l)).join('\n') + '\n')

  const store = new Store(tmp('errstats-state'))
  store.registerPersona(persona('builder', 'executor'))
  store.registerPersona(persona('reviewer', 'opus'))

  const stats = buildErrorStats(store, dir)

  // 7 record lỗi: llm-error, out-of-turns, salvage, build-fail, spec-fail (builder) + wrong-output (reviewer)
  check('total = 6', stats.total === 6, `(got ${stats.total})`)

  const cat = Object.fromEntries(stats.byCategory.map((c) => [c.category, c.count]))
  check('llm-error = 1', cat['llm-error'] === 1, `(got ${cat['llm-error']})`)
  check('out-of-turns = 1', cat['out-of-turns'] === 1, `(got ${cat['out-of-turns']})`)
  check('salvage = 1', cat['salvage'] === 1, `(got ${cat['salvage']})`)
  check('build-fail = 1', cat['build-fail'] === 1, `(got ${cat['build-fail']})`)
  check('spec-fail = 1', cat['spec-fail'] === 1, `(got ${cat['spec-fail']})`)
  check('wrong-output = 1', cat['wrong-output'] === 1, `(got ${cat['wrong-output']})`)

  // outcome thành công / tool_call / text KHÔNG bị tính
  check('không tính outcome thành công (advance/tool/text)', stats.total === 6)

  // byAgent: builder 5, reviewer 1
  const ag = Object.fromEntries(stats.byAgent.map((a) => [a.agent, a.count]))
  check('builder = 5 lỗi', ag['builder'] === 5, `(got ${ag['builder']})`)
  check('reviewer = 1 lỗi', ag['reviewer'] === 1, `(got ${ag['reviewer']})`)

  // byModel: executor (builder) 5, opus (reviewer) 1 — resolve qua personas
  const md = Object.fromEntries(stats.byModel.map((m) => [m.model, m.count]))
  check('model executor = 5', md['executor'] === 5, `(got ${md['executor']})`)
  check('model opus = 1', md['opus'] === 1, `(got ${md['opus']})`)

  // topCategory: tất cả category đều 1 → top là phần tử đầu sau sort (ổn định, không null)
  check('topCategory không null', stats.topCategory !== null, `(got ${stats.topCategory})`)

  // log rỗng → 0 lỗi, không crash
  const empty = buildErrorStats(store, tmp('errstats-empty'))
  check('log rỗng → total 0', empty.total === 0)
  check('log rỗng → topCategory null', empty.topCategory === null)

  // dòng JSONL hỏng (không parse được) bị bỏ qua, không crash
  const badDir = tmp('errstats-bad')
  fs.writeFileSync(path.join(badDir, 'turn-log.jsonl'), '{broken json\n' + JSON.stringify(LINES[0]) + '\n')
  const bad = buildErrorStats(store, badDir)
  check('dòng hỏng bị bỏ qua, vẫn đếm dòng tốt', bad.total === 1, `(got ${bad.total})`)

  // classifyTurn trực tiếp: outcome decision advance/done/delegate/needs_decision → null
  check('classify advance → null', classifyTurn({ agent: 'x', action: 'outcome', motive: 'm', outcome: 'o', decision: 'advance' }) === null)
  check('classify done → null', classifyTurn({ agent: 'x', action: 'outcome', motive: 'm', outcome: 'o', decision: 'done' }) === null)
  check('classify fail+build → build-fail', classifyTurn({ agent: 'x', action: 'outcome', motive: 'tsc', outcome: 'o', decision: 'fail' }) === 'build-fail')
  check('classify fail không keyword → other', classifyTurn({ agent: 'x', action: 'outcome', motive: 'abc', outcome: 'xyz', decision: 'fail' }) === 'other')

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
