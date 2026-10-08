// Smoke VERIFY-GATE LOOP — adversarial: verify LUÔN vỡ (exit 1) + agent LUÔN báo 'advance'.
// Chứng minh kết hợp verify-gate × loop-breaker: card KHÔNG bao giờ false-done, KHÔNG lặp vô hạn,
// mà sau maxStageVisits lần → escalate waiting_human (waitKind='loop') cho người quyết.
// smoke-verify-gate.ts chỉ test 1 chu kỳ verify-fail; đây test ĐƯỜNG DÀI (claim B3: "verify mãi
// không qua → raise gate cho người"). Dùng tick/claim/submit thật, KHÔNG spawn claude.

import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import { loadConfig } from './config'
import type { RunResult } from './types'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}
const tmp = (n: string) => { const d = path.join(process.cwd(), '.smoke', n); fs.rmSync(d, { recursive: true, force: true }); return d }
const CONFIG = path.join(process.cwd(), 'config')

const ADVANCE: RunResult = { outcome: { decision: 'advance', summary: 'agent lì: báo XONG dù verify vỡ' }, cost: { usd: 0, inTok: 0, outTok: 0 }, raw: '' }
const MAX_STAGE_VISITS = 3
const SAFETY_CAP = 20 // chặn test treo nếu loop-breaker hỏng — nếu vượt = BUG (lặp vô hạn)

function main() {
  console.log('🧪 smoke:verify-gate-loop — verify LUÔN vỡ + agent LUÔN advance → phải escalate, KHÔNG false-done/loop vô hạn')

  const store = new Store(tmp('verify-gate-loop'))
  loadConfig(store, CONFIG)
  const engine = new Engine(store, new MockRunner({}), new Budget({ windowMs: 3600e3, capUsd: 100 }), { perCardMaxUsd: 100, maxStageVisits: MAX_STAGE_VISITS })
  const pipe = engine.upsertPipeline({ name: 'vg-loop', stages: [{ name: 'Code', personaId: 'builder', verify: 'exit 1' }] })!
  const created = engine.createCard('loop card', 'làm gì đó verify luôn vỡ', pipe.id)

  // Đẩy nhiều chu kỳ: tick (dispatch + đếm stageVisits) → claim → submit advance (verify vỡ → queued lại).
  // Break khi card KHÔNG còn được dispatch (claim null = đã loop-cap) hoặc đạt trạng thái cuối.
  let cycles = 0
  let sawDone = false
  for (let i = 0; i < SAFETY_CAP; i++) {
    engine.tick()
    const spec = engine.claim()
    if (!spec) break // không claim được nữa = loop-breaker đã chặn dispatch (card waiting_human)
    cycles++
    engine.submit(spec.jobId, ADVANCE)
    const cur = store.getCard(created.id)!
    if (cur.status === 'done') { sawDone = true; break }
  }

  const card = store.getCard(created.id)!
  console.log(`   chạy ${cycles} chu kỳ submit-advance · trạng thái cuối: ${card.status}/${card.waitKind ?? '—'} · stageVisits=${JSON.stringify(card.stageVisits)}`)

  // ── Bằng chứng cốt lõi ──
  check('KHÔNG bao giờ false-done (verify vỡ mà card chưa hề done)', !sawDone && card.status !== 'done', `(sawDone=${sawDone}, status=${card.status})`)
  check('KHÔNG lặp vô hạn (số chu kỳ ≤ SAFETY_CAP)', cycles < SAFETY_CAP, `(cycles=${cycles})`)
  check('escalate đúng: waiting_human + waitKind=loop', card.status === 'waiting_human' && card.waitKind === 'loop', `(got ${card.status}/${card.waitKind})`)
  check('có pendingQuestion cho người quyết', !!card.pendingQuestion, `(got ${card.pendingQuestion})`)
  check('chu kỳ thật khớp loop-cap (= maxStageVisits)', cycles === MAX_STAGE_VISITS, `(cycles=${cycles}, max=${MAX_STAGE_VISITS})`)
  check('history KHÔNG có event done', !card.history.some((h) => h.event === 'done'), `(events=${card.history.map((h) => h.event).join(',')})`)
  check('mỗi chu kỳ đều verify-fail (n verify-fail = n chu kỳ)', card.history.filter((h) => h.event === 'verify-fail').length === cycles, `(verify-fail=${card.history.filter((h) => h.event === 'verify-fail').length})`)

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
