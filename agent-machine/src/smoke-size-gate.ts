// Smoke SIZE-GATE (C3) — task lớn bị chặn trước executor, task nhỏ qua thẳng.
// Dùng MockRunner (không đốt token).

import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import { loadConfig } from './config'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}
const tmp = (n: string) => { const d = path.join(process.cwd(), '.smoke', n); fs.rmSync(d, { recursive: true, force: true }); return d }
const CONFIG = path.join(process.cwd(), 'config')

async function main() {
  console.log('🧪 smoke:size-gate (C3) — task lớn chặn, task nhỏ qua thẳng')

  // ── Test 1: Large task → blocked at executor stage ──
  console.log('\n── Test 1: Task quá lớn (3000 chars) → size-gate chặn ──')
  {
    const store = new Store(tmp('size-gate-1'))
    loadConfig(store, CONFIG)
    const engine = new Engine(store, new MockRunner({}), new Budget({ windowMs: 3600e3, capUsd: 100 }), { perCardMaxUsd: 100 })
    const pipe = engine.upsertPipeline({
      name: 'size-gate-1',
      stages: [
        { name: 'Code feature', personaId: 'builder' }, // builder = executor
        { name: 'Review', personaId: 'reviewer', gate: true },
      ],
    })!
    const bigBrief = 'Chữ lớn. '.repeat(400) // ~3600 chars
    const card = engine.createCard('Large task', bigBrief, pipe.id)
    engine.tick()
    // tick() should block it at size-gate → waiting_human
    const c1 = store.getCard(card.id)!
    check('card bị chặn (waiting_human)', c1.status === 'waiting_human', `(got ${c1.status})`)
    check('waitKind = size-gate', c1.waitKind === 'size-gate', `(got ${c1.waitKind})`)
    check('pendingQuestion có thông báo size', (c1.pendingQuestion || '').includes('quá lớn'), `(got ${c1.pendingQuestion})`)
    check('history ghi size-gate-blocked', c1.history.some((h) => h.event === 'size-gate-blocked'), `(events=${c1.history.map(h => h.event).join(',')})`)
    check('KHÔNG có job pending (chưa dispatch)', engine['pending'].length === 0, `(got ${engine['pending'].length})`)

    // ── Approve để bỏ qua gate → card chạy tiếp ──
    engine.approve(card.id)
    const c1b = store.getCard(card.id)!
    check('approve → queued lại', c1b.status === 'queued', `(got ${c1b.status})`)
    check('history ghi size-gate-approved', c1b.history.some((h) => h.event === 'size-gate-approved'))
    check('GIỮ nguyên stageIndex=0 (executor stage)', c1b.stageIndex === 0, `(got ${c1b.stageIndex})`)
  }

  // ── Test 2: Small task → passes through directly ──
  console.log('\n── Test 2: Task nhỏ (100 chars) → qua thẳng executor ──')
  {
    const store = new Store(tmp('size-gate-2'))
    loadConfig(store, CONFIG)
    const engine = new Engine(store, new MockRunner({}), new Budget({ windowMs: 3600e3, capUsd: 100 }), { perCardMaxUsd: 100 })
    const pipe = engine.upsertPipeline({
      name: 'size-gate-2',
      stages: [
        { name: 'Code feature', personaId: 'builder' },
        { name: 'Review', personaId: 'reviewer', gate: true },
      ],
    })!
    const card = engine.createCard('Small task', 'Viết 1 hàm nhỏ xử lý validate input.', pipe.id)
    engine.tick()
    const c2 = store.getCard(card.id)!
    check('card working (đã dispatch)', c2.status === 'working', `(got ${c2.status})`)
    check('pending có job (sẵn sàng claim)', engine['pending'].length === 1, `(got ${engine['pending'].length})`)
    check('waitKind undefined (không bị chặn)', c2.waitKind === undefined, `(got ${c2.waitKind})`)
  }

  // ── Test 3: Non-executor stage (architect) → bỏ qua gate dù task lớn ──
  console.log('\n── Test 3: Task lớn ở stage architect (specialist) → không bị chặn ──')
  {
    const store = new Store(tmp('size-gate-3'))
    loadConfig(store, CONFIG)
    const engine = new Engine(store, new MockRunner({}), new Budget({ windowMs: 3600e3, capUsd: 100 }), { perCardMaxUsd: 100 })
    const pipe = engine.upsertPipeline({
      name: 'size-gate-3',
      stages: [
        { name: 'Thiết kế cách làm', personaId: 'architect' }, // architect = specialist
      ],
    })!
    const bigBrief = 'Mô tả kiến trúc. '.repeat(400) // ~3600 chars
    const card = engine.createCard('Large arch task', bigBrief, pipe.id)
    engine.tick()
    const c3 = store.getCard(card.id)!
    check('card working (dispatch qua architect)', c3.status === 'working', `(got ${c3.status})`)
    check('không bị size-gate chặn', c3.waitKind !== 'size-gate', `(got ${c3.waitKind})`)
  }

  // ── Test 4: Subtask (có parentId) → bỏ qua gate dù task lớn ──
  console.log('\n── Test 4: Subtask (parentId set) → bỏ qua gate ──')
  {
    const store = new Store(tmp('size-gate-4'))
    loadConfig(store, CONFIG)
    const engine = new Engine(store, new MockRunner({}), new Budget({ windowMs: 3600e3, capUsd: 100 }), { perCardMaxUsd: 100 })
    const pipe = engine.upsertPipeline({
      name: 'size-gate-4',
      stages: [
        { name: 'Code feature', personaId: 'builder' },
      ],
    })!
    const bigBrief = 'Subtask lớn. '.repeat(400) // ~3600 chars
    const parent = engine.createCard('Parent', 'brief', pipe.id)
    const child = engine.createCard('Large subtask', bigBrief, pipe.id, parent.id, 1) // depth>0, parentId set
    // Tick parent first (queued)
    engine.tick()
    // Manually queue child and tick
    const cChild = store.getCard(child.id)!
    cChild.status = 'queued'
    store.putCard(cChild)
    engine.tick()
    const c4 = store.getCard(child.id)!
    check('subtask working (bỏ qua size-gate)', c4.status === 'working', `(got ${c4.status})`)
    check('có job pending', engine['pending'].length >= 1)
  }

  // ── Test 5: Approve size-gate → card quay lại queued (cùng stage) ──
  console.log('\n── Test 5: Approve size-gate → queued lại stage 0 ──')
  {
    const store = new Store(tmp('size-gate-5'))
    loadConfig(store, CONFIG)
    const engine = new Engine(store, new MockRunner({}), new Budget({ windowMs: 3600e3, capUsd: 100 }), { perCardMaxUsd: 100 })
    const pipe = engine.upsertPipeline({
      name: 'size-gate-5',
      stages: [
        { name: 'Code', personaId: 'builder' },
        { name: 'Review', personaId: 'reviewer', gate: true },
      ],
    })!
    const bigBrief = 'X'.repeat(2000)
    const card = engine.createCard('Big', bigBrief, pipe.id)
    engine.tick()
    let c = store.getCard(card.id)!
    check('bị chặn', c.status === 'waiting_human')
    engine.approve(card.id)
    c = store.getCard(card.id)!
    check('queued lại', c.status === 'queued', `(got ${c.status})`)
    check('stageIndex=0 (giữ executor)', c.stageIndex === 0, `(got ${c.stageIndex})`)
    // Bây giờ tick() lần nữa → card dispatch được (vì stageVisits không reset nhưng approve đã cho qua)
    engine.tick()
    c = store.getCard(card.id)!
    check('tick lần 2 → working', c.status === 'working', `(got ${c.status})`)
  }

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
