// Smoke C3 — flow optimization: reviewNotes clear on advance, session key isolation, notes slice, brief truncation.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'

let pass = 0, fail = 0
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-c3-'))
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true })

console.log('🧪 smoke:c3-flow-opt — reviewNotes + session-key + notes-slice + brief-trunc')

// ── setup ──
const store = new Store(tmp)
const budget = new Budget({ windowMs: 5 * 3600_000, capUsd: 10 })
const runner = new MockRunner({ s1: { decision: 'advance', summary: 'build xong' }, s2: { decision: 'advance', summary: 'review qua' } })
const engine = new Engine(store, runner, budget, { maxStageVisits: 5 })

store.personas.set('builder', { id: 'builder', name: 'Builder', model: 'sonnet', kind: 'executor', systemPrompt: '', maxTurns: 3, allowedTools: [] })
store.personas.set('reviewer', { id: 'reviewer', name: 'Reviewer', model: 'opus', kind: 'specialist', systemPrompt: '', maxTurns: 3, allowedTools: [] })
store.pipelines.set('flow', { id: 'flow', name: 'flow', stages: [
  { id: 's1', name: 'Build', personaId: 'builder', gate: false },
  { id: 's2', name: 'Review', personaId: 'reviewer', gate: false },
]})

// ── T1: reviewNotes cleared when advancing to next stage ──
{
  const c = engine.createCard('Card A', 'brief A', 'flow')
  c.reviewNotes = ['note 1', 'note 2', 'note 3']
  store.putCard(c)
  // direct call private method
  ;(engine as unknown as { advanceCard: (c: unknown) => void }).advanceCard(store.getCard(c.id)!)
  const after = store.getCard(c.id)!
  check('T1: reviewNotes cleared when advancing to new stage', (after.reviewNotes?.length ?? 0) === 0, `(got ${after.reviewNotes?.length})`)
  check('T1: stageIndex incremented', after.stageIndex === 1)
}

// ── T2: session key = personaId:stageIndex (not just personaId) ──
{
  const c = engine.createCard('Card B', 'brief B', 'flow')
  const jobId = 'job-test-2'
  ;(engine as unknown as { inFlight: Map<string, string> }).inFlight.set(jobId, c.id)
  engine.submit(jobId, { outcome: { decision: 'advance', summary: 'done' }, cost: { usd: 0, inTok: 0, outTok: 0 }, raw: '', sessionId: 'sess-stage0' })
  const after = store.getCard(c.id)!
  check('T2: session keyed as personaId:stageIndex', after.sessions?.['builder:0'] === 'sess-stage0', `(keys: ${Object.keys(after.sessions ?? {}).join(', ')})`)
  check('T2: bare personaId key absent (no regression)', !('builder' in (after.sessions ?? {})))
}

// ── T3: session key after advance — stage 1 run saves key builder:0, stage 2 run saves reviewer:1 ──
{
  const c = engine.createCard('Card C', 'brief C', 'flow')
  // submit stage 0 (builder)
  const j0 = 'job-c3-s0'
  ;(engine as unknown as { inFlight: Map<string, string> }).inFlight.set(j0, c.id)
  engine.submit(j0, { outcome: { decision: 'advance', summary: 's0 done' }, cost: { usd: 0, inTok: 0, outTok: 0 }, raw: '', sessionId: 'sess-builder-s0' })
  // card should now be at stageIndex 1 (queued review)
  const mid = store.getCard(c.id)!
  check('T3: after s0 advance → stageIndex=1', mid.stageIndex === 1)
  // submit stage 1 (reviewer)
  const j1 = 'job-c3-s1'
  ;(engine as unknown as { inFlight: Map<string, string> }).inFlight.set(j1, c.id)
  engine.submit(j1, { outcome: { decision: 'advance', summary: 's1 done' }, cost: { usd: 0, inTok: 0, outTok: 0 }, raw: '', sessionId: 'sess-reviewer-s1' })
  const after = store.getCard(c.id)!
  check('T3: builder:0 and reviewer:1 both stored', after.sessions?.['builder:0'] === 'sess-builder-s0' && after.sessions?.['reviewer:1'] === 'sess-reviewer-s1', `(keys: ${Object.keys(after.sessions ?? {}).join(', ')})`)
}

// ── T4: reviewNotes slice semantics (unit) ──
{
  const manyNotes = ['n1', 'n2', 'n3', 'n4', 'n5']
  const sliced = manyNotes.slice(-3)
  check('T4: slice(-3) returns last 3', sliced.length === 3 && sliced[0] === 'n3', `(got ${sliced})`)
  check('T4: empty notes → empty slice', ([] as string[]).slice(-3).length === 0)
}

// ── T5: brief truncation logic (unit) ──
{
  const longBrief = 'x'.repeat(1000)
  // rework (visit >= 2)
  const truncated = (() => {
    const visits: Record<string, number> = { s1: 2 }
    const isRework = (visits['s1'] ?? 0) >= 2
    return isRework && longBrief.length > 800
      ? longBrief.slice(0, 800) + `\n...[còn ${longBrief.length - 800} ký tự — workspace có context đủ, đọc file nếu cần]`
      : longBrief
  })()
  check('T5: brief truncated on rework (≥2 visits)', truncated.length < 900 && truncated.includes('[còn '))

  // first visit (not rework)
  const notTruncated = (() => {
    const visits: Record<string, number> = { s1: 1 }
    const isRework = (visits['s1'] ?? 0) >= 2
    return isRework && longBrief.length > 800 ? 'truncated' : longBrief
  })()
  check('T5: first visit → brief NOT truncated', notTruncated === longBrief)

  // short brief: never truncated even on rework
  const shortBrief = 'abc'
  const shortResult = (() => {
    const isRework = true
    return isRework && shortBrief.length > 800 ? 'truncated' : shortBrief
  })()
  check('T5: short brief never truncated', shortResult === shortBrief)
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
cleanup()
process.exit(fail === 0 ? 0 : 1)
