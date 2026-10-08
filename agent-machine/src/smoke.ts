// Smoke test — assert hành vi lõi + guardrail. Exit 1 nếu fail. KHÔNG đốt token (MockRunner).
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import { loadConfig } from './config'
import type { Outcome } from './types'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}
const tmp = (n: string) => { const d = path.join(process.cwd(), '.smoke', n); fs.rmSync(d, { recursive: true, force: true }); return d }
const CONFIG = path.join(process.cwd(), 'config')

const script: Record<string, Outcome> = {
  draft: { decision: 'delegate', summary: 'stuck: web không render', delegateTo: { personaId: 'engineer', title: 'Fix render', brief: 'fix', pipelineId: 'eng' } },
  fix: { decision: 'done', summary: 'fixed' },
  review: { decision: 'advance', summary: 'reviewed' },
  ship: { decision: 'advance', summary: 'shipped' },
}

async function t1() {
  console.log('\nT1 — config-from-files + delegate/hold/resume + gate + approve')
  const store = new Store(tmp('t1'))
  const loaded = loadConfig(store, CONFIG)
  check('config nạp personas ≥ 3', loaded.personas >= 3, `(got ${loaded.personas})`)
  check('config nạp pipelines ≥ 2', loaded.pipelines >= 2, `(got ${loaded.pipelines})`)
  const engine = new Engine(store, new MockRunner(script), new Budget({ windowMs: 5 * 3600e3, capUsd: 5 }), { perCardMaxUsd: 5 })
  const card = engine.createCard('Course', 'brief', 'course')
  await engine.runUntilIdle()
  const c1 = store.getCard(card.id)!
  check('card kẹt ở GATE (waiting_human)', c1.status === 'waiting_human', `(got ${c1.status})`)
  check('child engineer đã DONE (hold/resume)', store.listCards().some((c) => c.parentId === card.id && c.status === 'done'))
  engine.approve(card.id)
  await engine.runUntilIdle()
  check('card chính DONE sau approve', store.getCard(card.id)!.status === 'done', `(got ${store.getCard(card.id)!.status})`)
  check('channels có log (≥6 msg)', store.readChannel().length >= 6, `(got ${store.readChannel().length})`)
  check('C1: card lưu report đầy đủ', (store.getCard(card.id)!.reports?.length ?? 0) >= 1, `(got ${store.getCard(card.id)!.reports?.length ?? 0})`)
  check('C1: channel có message kind=report', store.readChannel().some((m) => m.kind === 'report'))
  check('CACHE: card lưu session theo persona (rework --resume)', Object.keys(store.getCard(card.id)!.sessions || {}).length >= 1)
  check('ledger ghi cost', fs.existsSync(path.join(store.dir, 'ledger.jsonl')))
}

async function t2() {
  console.log('\nT2 — guardrail: budget cửa chạm cap → PAUSE')
  const store = new Store(tmp('t2'))
  loadConfig(store, CONFIG)
  const engine = new Engine(store, new MockRunner(script, { usd: 0.02, inTok: 1, outTok: 1 }), new Budget({ windowMs: 5 * 3600e3, capUsd: 0.03 }), {})
  const card = engine.createCard('Course', 'brief', 'course')
  await engine.runUntilIdle()
  check('engine PAUSED khi chạm cap', engine.paused === true)
  check('card chính CHƯA done (bị chặn)', store.getCard(card.id)!.status !== 'done', `(got ${store.getCard(card.id)!.status})`)
}

async function t3() {
  console.log('\nT3 — guardrail: per-card cost cap → waiting_human')
  const store = new Store(tmp('t3'))
  loadConfig(store, CONFIG)
  const engine = new Engine(store, new MockRunner(script, { usd: 0.05, inTok: 1, outTok: 1 }), new Budget({ windowMs: 5 * 3600e3, capUsd: 999 }), { perCardMaxUsd: 0.04 })
  const card = engine.createCard('Course', 'brief', 'course')
  await engine.runUntilIdle()
  const c = store.getCard(card.id)!
  check('card chạm cost-cap → waiting_human', c.status === 'waiting_human', `(got ${c.status})`)
  check('lý do nhắc chi phí', (c.pendingQuestion || '').includes('chi phí'))
}

async function t4() {
  console.log('\nT4 — guardrail: depth-breaker (delegate vòng vô hạn → HALT, bounded)')
  const store = new Store(tmp('t4'))
  loadConfig(store, CONFIG)
  // pipeline 1 stage cứ delegate lại chính nó → chuỗi sâu dần → depth-breaker chặn
  store.registerPipeline({ id: 'loop', name: 'Loop test', stages: [{ id: 's', name: 'S', personaId: 'engineer' }] })
  const loopScript: Record<string, Outcome> = { s: { decision: 'delegate', summary: 'vòng', delegateTo: { personaId: 'engineer', title: 'child', brief: 'x', pipelineId: 'loop' } } }
  const engine = new Engine(store, new MockRunner(loopScript, { usd: 0.001, inTok: 1, outTok: 1 }), new Budget({ windowMs: 5 * 3600e3, capUsd: 999 }), { maxDepth: 3 })
  engine.createCard('root', 'x', 'loop')
  await engine.runUntilIdle(200)
  const failed = store.listCards().filter((c) => c.status === 'failed')
  check('depth-breaker HALT ít nhất 1 card', failed.length >= 1, `(failed=${failed.length})`)
  check('bounded — không nổ vô hạn (card < 15)', store.listCards().length < 15, `(cards=${store.listCards().length})`)
}

async function t5() {
  console.log('\nT5 — loop-cap: rework quá nhiều → GATE người (không fail, không lặp vô hạn đốt token)')
  const store = new Store(tmp('t5'))
  loadConfig(store, CONFIG)
  store.registerPipeline({ id: 'bt', name: 'Build-Test', stages: [{ id: 'b', name: 'Build', personaId: 'builder' }, { id: 't', name: 'Test', personaId: 'tester' }] })
  const s: Record<string, Outcome> = { b: { decision: 'advance', summary: 'built' }, t: { decision: 'rework', summary: 'bug X chưa fix' } } // test cứ rework
  const engine = new Engine(store, new MockRunner(s, { usd: 0.001, inTok: 1, outTok: 1 }), new Budget({ windowMs: 5 * 3600e3, capUsd: 999 }), { maxStageVisits: 3 })
  const card = engine.createCard('loopy', 'x', 'bt')
  await engine.runUntilIdle(100)
  const c = store.getCard(card.id)!
  check('loop-cap → waiting_human (KHÔNG fail)', c.status === 'waiting_human', `(got ${c.status})`)
  check('waitKind = loop', c.waitKind === 'loop', `(got ${c.waitKind})`)
  check('bounded (build ≤ cap+1)', (c.stageVisits?.b ?? 0) <= 4, `(got ${c.stageVisits?.b})`)
  engine.approve(card.id)
  check('approve reset đếm loop', Object.keys(store.getCard(card.id)!.stageVisits || {}).length === 0)
}

async function main() {
  console.log('🧪 Lucy Agent Machine — smoke test (no token burn)')
  await t1(); await t2(); await t3(); await t4(); await t5()
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
