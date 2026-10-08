// smoke-autopilot — verify Lucy-director (claude -p) duyệt/trả-lại THẬT + pure logic.
// Cần claude trong PATH. Dùng AM_DIRECTOR_MODEL=sonnet để rẻ (mặc định opus cho prod).
import { isProtectedGate, lastJson, directorDecide } from './autopilot'
import type { Card, Persona, Pipeline } from './types'

function fail(m: string): never { console.error('❌ ' + m); process.exit(1) }

// ── 1. pure: lastJson ──
if ((lastJson('xx ```json\n{"a":1}\n``` yy') as { a?: number })?.a !== 1) fail('lastJson fenced')
if ((lastJson('rác {"action":"approve","reason":"ok"} đuôi') as { action?: string })?.action !== 'approve') fail('lastJson bare obj')
if (!Array.isArray(lastJson('[{"t":1}]'))) fail('lastJson array')
console.log('✓ lastJson OK')

// ── 2. pure: isProtectedGate ──
const P = (id: string): Persona => ({ id, name: id, systemPrompt: 'x', model: 'sonnet' })
const pipe = (id: string): Pipeline => ({ id, name: id, stages: [] })
if (!isProtectedGate(pipe('feature'), P('devops'))) fail('devops phải protected')
if (!isProtectedGate(pipe('feature'), P('security'))) fail('security phải protected')
if (!isProtectedGate(pipe('secure-ship'), P('builder'))) fail('secure-ship phải protected')
if (isProtectedGate(pipe('feature'), P('reviewer'))) fail('reviewer KHÔNG protected')
console.log('✓ isProtectedGate OK (deploy/security để Bill)')

// ── 3. real: directorDecide (2 card) ──
const now = Date.now()
const base = (over: Partial<Card>): Card => ({ id: 'x', title: '', brief: '', pipelineId: 'feature', projectId: 'smoke', stageIndex: 3, status: 'waiting_human', waitKind: 'gate', workspace: '', depth: 0, blockedBy: [], cost: { usd: 0, inTok: 0, outTok: 0 }, history: [], createdAt: now, updatedAt: now, ...over })

const good = base({
  title: 'Thêm hàm sum(a,b)', brief: 'Thêm sum(a,b) ở src/math.ts trả a+b, có test. Done = test xanh.',
  reports: [{ stage: 'build', persona: 'Tanjiro', text: 'Đã thêm export function sum(a,b){return a+b} ở src/math.ts + test sum.test.ts. Chạy `npm test`: 5/5 pass. Build (tsc) sạch.', ts: now }],
  artifacts: { files: ['src/math.ts', 'src/math.test.ts'], diffstat: 'src/math.ts | 3 +\n src/math.test.ts | 9 +' },
})
const bad = base({
  title: 'Thêm hàm sum(a,b)', brief: 'Thêm sum(a,b) ở src/math.ts trả a+b, có test. Done = test xanh.',
  reports: [{ stage: 'build', persona: 'Tanjiro', text: 'Mình nghĩ chắc xong rồi. Chưa chạy test, không chắc build.', ts: now }],
})

;(async () => {
  console.log(`▶ director model=${process.env.AM_DIRECTOR_MODEL || 'opus'} — gọi claude thật...`)
  const dg = await directorDecide(good, 'Review chất lượng')
  console.log(`  GOOD → ${dg.action}: ${dg.reason}`)
  const db = await directorDecide(bad, 'Review chất lượng')
  console.log(`  BAD  → ${db.action}: ${db.reason}`)
  const validG = dg.action === 'approve' || dg.action === 'return'
  const validB = db.action === 'approve' || db.action === 'return'
  if (!validG || !validB) fail('director không trả GateDecision hợp lệ')
  const sane = dg.action === 'approve' && db.action === 'return'
  console.log(sane ? '✅ PASS — duyệt card-tốt, trả-lại card chưa-verify (đúng kỳ vọng)' : '⚠️ plumbing OK nhưng phán đoán khác kỳ vọng (xem lý do ở trên)')
  process.exit(0)
})()
