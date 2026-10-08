// Smoke VERIFY-GATE — chống false-done: agent tự báo 'advance' KHÔNG đủ, engine chạy lệnh
// khách quan (stage.verify) ở workspace. exit≠0 → ép rework CHÍNH stage (KHÔNG advance);
// exit 0 → advance bình thường; stage không khai verify → hành vi y cũ (zero regression).
// Dùng submit() trực tiếp (không spawn claude). KHÔNG đốt token.

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

// agent tự đóng dấu 'advance' (giả lập false-done khi verify vỡ)
const ADVANCE: RunResult = { outcome: { decision: 'advance', summary: 'agent tự báo XONG' }, cost: { usd: 0, inTok: 0, outTok: 0 }, raw: '' }

// Mỗi scenario engine RIÊNG → tick()/claim() không lẫn card scenario khác (card verify-fail còn queued
// sẽ bị tick re-dispatch và claim() nhầm). Trả {engine, card} đã chạy 1 chu kỳ advance.
function runScenario(name: string, verify: string | undefined) {
  const store = new Store(tmp(`verify-gate-${name}`))
  loadConfig(store, CONFIG)
  const engine = new Engine(store, new MockRunner({}), new Budget({ windowMs: 3600e3, capUsd: 100 }), { perCardMaxUsd: 100 })
  const stage: { name: string; personaId: string; verify?: string } = { name: 'Code', personaId: 'builder', ...(verify ? { verify } : {}) }
  const pipe = engine.upsertPipeline({ name: `vg-${name}`, stages: [stage] })!
  const card = engine.createCard(`${name} card`, 'làm gì đó', pipe.id)
  engine.tick()
  const spec = engine.claim()
  if (!spec) throw new Error('claim() trả null — card không vào hàng?')
  engine.submit(spec.jobId, ADVANCE) // agent tự báo advance — verify-gate quyết định có cho qua không
  return { pipe, card: store.getCard(card.id)! }
}

function main() {
  console.log('🧪 smoke:verify-gate — chống false-done bằng lệnh khách quan stage.verify')

  // ── Test 1: verify FAIL (exit 1) → KHÔNG advance, ép rework chính stage ──
  console.log('\n── Test 1: verify FAIL → chống false-done ──')
  const fail1 = runScenario('fail', 'exit 1')
  check('stage.verify forward đúng', fail1.pipe.stages[0].verify === 'exit 1', `(got ${fail1.pipe.stages[0].verify})`)
  const a1 = fail1.card
  check('agent báo advance NHƯNG card KHÔNG done', a1.status !== 'done', `(got ${a1.status})`)
  check('card quay lại queued (lặp lại stage)', a1.status === 'queued', `(got ${a1.status})`)
  check('GIỮ NGUYÊN stageIndex=0', a1.stageIndex === 0, `(got ${a1.stageIndex})`)
  check('reviewNotes có "VERIFY FAIL"', (a1.reviewNotes || []).some((n) => n.includes('VERIFY FAIL')), `(got ${JSON.stringify(a1.reviewNotes)})`)
  check('history ghi verify-fail', a1.history.some((h) => h.event === 'verify-fail'))

  // ── Test 2: verify PASS (exit 0) → advance bình thường (stage cuối → done) ──
  console.log('\n── Test 2: verify PASS → advance bình thường ──')
  const a2 = runScenario('pass', 'exit 0').card
  check('verify qua → card DONE', a2.status === 'done', `(got ${a2.status})`)

  // ── Test 3: KHÔNG khai verify → hành vi y cũ (zero regression) ──
  console.log('\n── Test 3: stage không verify → advance như cũ ──')
  const none = runScenario('none', undefined)
  check('stage không verify → field undefined', none.pipe.stages[0].verify === undefined)
  check('không verify → card DONE bình thường', none.card.status === 'done', `(got ${none.card.status})`)

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
