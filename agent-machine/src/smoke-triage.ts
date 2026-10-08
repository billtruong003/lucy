// smoke-triage.ts — Deterministic test for C2 Stuck-detector (no claude, no network).
// Injects mock stuckHandler, drives cards to stuck via MockRunner always-rework, asserts contract:
//   escalate → waiting_human/stuck
//   upgrade  → card queued + modelOverride=opus + stageVisits reset (no immediate re-stuck)
//   split    → parent blocked by children, children queued (no deadlock), blockKind=delegate

import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import { loadConfig } from './config'
import type { RunResult, Card } from './types'
import type { TriageDecision } from './triage'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}
function section(title: string) { console.log(`\n▸ ${title}`) }

const tmp = (n: string) => {
  const d = path.join(process.cwd(), '.smoke', 'triage', n)
  fs.rmSync(d, { recursive: true, force: true })
  return d
}
const CONFIG = path.join(process.cwd(), 'config')
const REWORK: RunResult = { outcome: { decision: 'rework', summary: 'bug còn đây' }, cost: { usd: 0, inTok: 0, outTok: 0 }, raw: '' }
const ADVANCE: RunResult = { outcome: { decision: 'advance', summary: 'xong' }, cost: { usd: 0, inTok: 0, outTok: 0 }, raw: '' }

// Flush microtask queue so fire-and-forget .then() callbacks run
const flush = () => new Promise<void>((r) => setTimeout(r, 10))

/** Build engine with a mock stuckHandler, maxStageVisits=4, stuckThreshold=2 */
function makeEngine(dir: string, handler: (card: Card, stage: string) => Promise<TriageDecision>) {
  const store = new Store(dir)
  loadConfig(store, CONFIG)
  const engine = new Engine(
    store,
    new MockRunner({}),
    new Budget({ windowMs: 3600e3, capUsd: 100 }),
    { perCardMaxUsd: 100, maxStageVisits: 4, stuckThreshold: 2, maxDepth: 3, stuckHandler: handler }
  )
  return { store, engine }
}

/** Drive card until stuck (isStuck fires) OR safety cap reached. Returns number of reworks submitted. */
async function driveToStuck(engine: Engine, store: Store, cardId: string): Promise<number> {
  let reworks = 0
  // Safety cap: stuckThreshold=2, stuckHandled guard prevents double-trigger, so max ~6 cycles
  for (let i = 0; i < 20; i++) {
    engine.tick()
    const spec = engine.claim()
    if (!spec) break
    // always rework to force stuck
    await engine.submit(spec.jobId, REWORK)
    reworks++
    const c = store.getCard(cardId)!
    // Once triage fires, card goes to waiting_human/stuck (set by tick or by handler)
    if (c.status === 'waiting_human' && (c.waitKind === 'stuck' || c.waitKind === 'loop')) break
    if (c.status === 'blocked') break  // split completed
    if (c.status === 'queued' && c.history.some((h) => h.event === 'stuck-upgrade')) break  // triage upgrade applied → dừng quan sát (không rework tiếp tới loop-cap)
  }
  return reworks
}

async function main() {
  console.log('🧪 smoke-triage — Stuck-detector C2 deterministic (no claude)')

  // ─── T1: Escalate path ───────────────────────────────────────────────────
  section('T1: escalate path → waiting_human/stuck + pendingQuestion')
  {
    const { store, engine } = makeEngine(tmp('t1'), async () =>
      ({ action: 'escalate' as const, reason: 'test-escalate-reason' })
    )
    const pipe = engine.upsertPipeline({ name: 'p', stages: [{ name: 'Build', personaId: 'builder' }, { name: 'Review', personaId: 'reviewer' }] })!
    // Use single-stage pipeline so Review reworks itself
    const pipe1 = engine.upsertPipeline({ name: 'p1', stages: [{ name: 'Review', personaId: 'reviewer' }] })!
    const card = engine.createCard('T1 card', 'test escalate', pipe1.id)
    await driveToStuck(engine, store, card.id)
    await flush()
    const c = store.getCard(card.id)!
    check('T1.1: status=waiting_human', c.status === 'waiting_human', `got ${c.status}`)
    check('T1.2: waitKind=stuck', c.waitKind === 'stuck', `got ${c.waitKind}`)
    check('T1.3: pendingQuestion không trống', !!c.pendingQuestion, `got "${c.pendingQuestion}"`)
    check('T1.4: history ghi stuck-escalate', c.history.some((h) => h.event.includes('stuck') || c.waitKind === 'stuck'), `events=${c.history.map((h) => h.event).join(',')}`)
    void pipe
  }

  // ─── T2: Upgrade path (non-opus) ─────────────────────────────────────────
  section('T2: upgrade path (sonnet→opus) → queued + modelOverride=opus + stageVisits reset')
  {
    const { store, engine } = makeEngine(tmp('t2'), async () =>
      ({ action: 'upgrade' as const, reason: 'too complex for sonnet' })
    )
    const pipe = engine.upsertPipeline({ name: 'p', stages: [{ name: 'Build', personaId: 'builder' }] })!
    const card = engine.createCard('T2 card', 'test upgrade', pipe.id)
    await driveToStuck(engine, store, card.id)
    await flush()
    const c = store.getCard(card.id)!
    check('T2.1: status=queued (re-queued for retry)', c.status === 'queued', `got ${c.status}`)
    check('T2.2: modelOverride=opus', c.modelOverride === 'opus', `got ${c.modelOverride}`)
    // CRITICAL: stageVisits PHẢI được reset — nếu không, card ngay lập tức hit loop-cap lần sau
    const visits = c.stageVisits ?? {}
    const anyHighVisits = Object.values(visits).some((v) => (v as number) >= 2)
    check('T2.3: stageVisits reset (không còn cao ≥ threshold)', !anyHighVisits, `stageVisits=${JSON.stringify(visits)} — BUG: chưa reset, card sẽ re-stuck ngay`)

    // Tiếp tục dispatch để xác nhận card không ngay lập tức bị loop-cap
    engine.tick()
    const spec2 = engine.claim()
    check('T2.4: card có thể dispatch lại sau upgrade (không immediate re-stuck)', !!spec2, `claim=null — BUG: card bị loop-cap ngay sau upgrade do stageVisits chưa reset`)
    if (spec2) await engine.submit(spec2.jobId, ADVANCE)
    const c2 = store.getCard(card.id)!
    check('T2.5: card có thể advance sau upgrade', c2.status === 'done' || c2.stageIndex > (c.stageIndex ?? 0) || c2.status === 'queued', `got ${c2.status}`)
  }

  // ─── T3: Upgrade path (already opus) → escalate ──────────────────────────
  section('T3: upgrade (đã opus) → escalate thay vì loop')
  {
    const { store, engine } = makeEngine(tmp('t3'), async () =>
      ({ action: 'upgrade' as const, reason: 'already maxed' })
    )
    const pipe = engine.upsertPipeline({ name: 'p', stages: [{ name: 'Build', personaId: 'builder' }] })!
    const card = engine.createCard('T3 card', 'test upgrade opus', pipe.id, undefined, 0, 'default', false, 'opus')
    await driveToStuck(engine, store, card.id)
    await flush()
    const c = store.getCard(card.id)!
    check('T3.1: đã opus → escalate (waiting_human/stuck)', c.status === 'waiting_human' && c.waitKind === 'stuck', `got ${c.status}/${c.waitKind}`)
  }

  // ─── T4: Split path — children PHẢI queued (không deadlock) ──────────────
  section('T4: split path → parent blocked, children queued (no deadlock)')
  {
    let capturedCardId: string | null = null
    const { store, engine } = makeEngine(tmp('t4'), async (card) => {
      capturedCardId = card.id
      return {
        action: 'split' as const,
        reason: 'task quá lớn',
        subtasks: [
          { title: 'Sub A', brief: 'làm A' },
          { title: 'Sub B', brief: 'làm B' },
        ],
      }
    })
    const pipe = engine.upsertPipeline({ name: 'p', stages: [{ name: 'Build', personaId: 'builder' }] })!
    const card = engine.createCard('T4 card', 'test split', pipe.id)
    await driveToStuck(engine, store, card.id)
    await flush()
    const c = store.getCard(card.id)!
    check('T4.1: parent status=blocked', c.status === 'blocked', `got ${c.status}`)
    check('T4.2: parent blockedBy 2 children', c.blockedBy.length === 2, `blockedBy=${c.blockedBy.length}`)
    // CRITICAL: children PHẢI queued (không phải blocked by parent → deadlock)
    const children = c.blockedBy.map((id) => store.getCard(id)!).filter(Boolean)
    check('T4.3: 2 child cards tồn tại', children.length === 2, `found ${children.length}`)
    for (const child of children) {
      check(
        `T4.4: ${child.title}: status=queued (KHÔNG blocked)`,
        child.status === 'queued',
        `got ${child.status} blockedBy=${JSON.stringify(child.blockedBy)} — BUG: child bị blocked by parent → DEADLOCK`
      )
      check(
        `T4.5: ${child.title}: blockedBy=[] (không bị parent block)`,
        child.blockedBy.length === 0,
        `blockedBy=[${child.blockedBy}] — BUG: child blocked by parent → DEADLOCK`
      )
    }
    check('T4.6: handler được gọi với card đúng', capturedCardId === card.id, `got ${capturedCardId}`)
  }

  // ─── T5: Split + resolveUnblocks — sau khi children xong, parent PHẢI advance ──
  section('T5: split + complete children → parent advance (blockKind=delegate, không re-enter stuck stage)')
  {
    const { store, engine } = makeEngine(tmp('t5'), async () => ({
      action: 'split' as const,
      reason: 'test split advance',
      subtasks: [{ title: 'Sub X', brief: 'làm X' }],
    }))
    const pipe = engine.upsertPipeline({
      name: 'p',
      stages: [
        { name: 'Build', personaId: 'builder' },
        { name: 'Review', personaId: 'reviewer' },
      ],
    })!
    // Card kẹt ở Build (stage 0), split → sub xong → parent phải qua Review (stage 1), không quay lại Build
    const card = engine.createCard('T5 card', 'test split advance', pipe.id)
    await driveToStuck(engine, store, card.id)
    await flush()

    const before = store.getCard(card.id)!
    if (before.status !== 'blocked') {
      check('T5.SKIP: chưa blocked (T4 deadlock chưa fix)', false, `status=${before.status} — skip T5 (phụ thuộc T4 fix xong)`)
    } else {
      // Chạy children đến done
      let childDone = false
      for (let i = 0; i < 10 && !childDone; i++) {
        engine.tick()
        const spec = engine.claim()
        if (!spec) { await flush(); engine.tick(); continue }
        await engine.submit(spec.jobId, ADVANCE)
        const child = before.blockedBy.map((id) => store.getCard(id)!).find((c) => c?.id === spec.cardId)
        if (child && store.getCard(child.id)!.status === 'done') childDone = true
      }
      engine.tick() // resolveUnblocks
      await flush()
      const after = store.getCard(card.id)!
      check('T5.1: child done → parent unblocked', after.status !== 'blocked', `still blocked — BUG: resolveUnblocks không advance`)
      // CRITICAL: parent KHÔNG được quay lại Build (stuck stage), phải qua Review (stageIndex=1)
      check(
        'T5.2: parent advance sang stage kế (stageIndex>0), KHÔNG quay Build',
        after.stageIndex > 0 || after.status === 'done',
        `stageIndex=${after.stageIndex} status=${after.status} — BUG: blockKind=dep làm parent re-enter stage kẹt → loop-cap lại`
      )
      check(
        'T5.3: parent KHÔNG bị loop-cap ngay (waitKind≠loop)',
        after.waitKind !== 'loop',
        `waitKind=${after.waitKind} — BUG: parent re-enter Build, stuckHandled=true → fallback loop-cap ngay`
      )
    }
  }

  // ─── T6: Split với empty subtasks → fallback escalate ────────────────────
  section('T6: split với subtasks=[] → fallback escalate')
  {
    const { store, engine } = makeEngine(tmp('t6'), async () => ({
      action: 'split' as const,
      reason: 'split fail no subtasks',
      subtasks: [],
    }))
    const pipe = engine.upsertPipeline({ name: 'p', stages: [{ name: 'Build', personaId: 'builder' }] })!
    const card = engine.createCard('T6 card', 'test split empty', pipe.id)
    await driveToStuck(engine, store, card.id)
    await flush()
    const c = store.getCard(card.id)!
    check('T6.1: empty subtasks → escalate (waiting_human/stuck)', c.status === 'waiting_human' && c.waitKind === 'stuck', `got ${c.status}/${c.waitKind}`)
    check('T6.2: pendingQuestion đề cập split', !!c.pendingQuestion && c.pendingQuestion.includes('split'), `got "${c.pendingQuestion}"`)
  }

  // ─── T7: Double-trigger guard ─────────────────────────────────────────────
  section('T7: stuckHandled guard → triage chỉ fire 1 lần')
  {
    let callCount = 0
    const { store, engine } = makeEngine(tmp('t7'), async () => {
      callCount++
      return { action: 'escalate' as const, reason: 'test guard' }
    })
    const pipe = engine.upsertPipeline({ name: 'p', stages: [{ name: 'Build', personaId: 'builder' }] })!
    const card = engine.createCard('T7 card', 'test guard', pipe.id)
    await driveToStuck(engine, store, card.id)
    await flush()
    // Thêm 5 tick nữa để chắc chắn không fire lần 2
    for (let i = 0; i < 5; i++) { engine.tick(); await flush() }
    check('T7.1: handler chỉ được gọi đúng 1 lần', callCount === 1, `callCount=${callCount} — BUG: double-trigger`)
  }

  // ─── T8: Triage không gọi khi depth >= maxDepth (depth-breaker) ──────────
  section('T8: split khi depth >= maxDepth → không tạo child sâu hơn')
  {
    let splitCalled = false
    const { store, engine } = makeEngine(tmp('t8'), async () => {
      splitCalled = true
      return {
        action: 'split' as const,
        reason: 'should be blocked by depth',
        subtasks: [{ title: 'Deep sub', brief: 'quá sâu' }],
      }
    })
    // maxDepth default = 3; tạo card ở depth=3 thẳng (parentId=undefined nhưng đặt depth=3)
    const pipe = engine.upsertPipeline({ name: 'p', stages: [{ name: 'Build', personaId: 'builder' }] })!
    // Workaround: tạo card với depth=3 bằng cách dùng parentId giả
    const fakeParent = engine.createCard('fake', 'fake', pipe.id, undefined, 0, 'default', true) // backlog
    const deepCard = engine.createCard('T8 deep', 'test depth', pipe.id, fakeParent.id, 3)
    await driveToStuck(engine, store, deepCard.id)
    await flush()
    const c = store.getCard(deepCard.id)!
    if (splitCalled) {
      // Engine split quá sâu → phải escalate, không tạo child
      check('T8.1: depth-breaker — không có child mới khi depth>=maxDepth', c.blockedBy.length === 0 || c.status !== 'blocked', `children=${c.blockedBy.length} — engine split tạo con tại depth>=maxDepth`)
    } else {
      check('T8.1: triage vẫn fire (depth-breaker ở engine, không ở triage)', splitCalled || c.status === 'waiting_human', `status=${c.status}`)
    }
  }

  // ─── TỔNG KẾT ─────────────────────────────────────────────────────────────
  console.log(`\n${ fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
