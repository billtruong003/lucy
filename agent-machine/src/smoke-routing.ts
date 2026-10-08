// Smoke BH-D — routing tự học từ outcome thật.
// JSONL roundtrip + groupByModel + pickLearnedModel (head-fallback / override an toàn) + routeTask học.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appendOutcome, readOutcomes, groupByModel, pickLearnedModel, MIN_SAMPLES, type RoutingOutcome } from './routing-outcome'
import { routeTask, ROUTE_TABLE } from './chat-lane'

let pass = 0, fail = 0
const check = (n: string, c: boolean, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${e}`) } }

console.log('🧪 smoke:routing — BH-D meta-learning (routing tự học)')

// temp vault
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-routing-'))
function mk(model: string, rating: 'good' | 'bad', extra: Partial<RoutingOutcome> = {}): RoutingOutcome {
  return { ts: 1700000000000, model, rating, ...extra }
}

// ── JSONL roundtrip ──
{
  appendOutcome(tmp, mk('m-a', 'good', { taskType: 'reasoning', comment: 'ok' }))
  appendOutcome(tmp, mk('m-a', 'bad'))
  appendOutcome(tmp, mk('m-b', 'good'))
  const all = readOutcomes(tmp)
  check('append→read giữ đủ 3 dòng', all.length === 3, String(all.length))
  check('giữ field taskType/comment', all[0].taskType === 'reasoning' && all[0].comment === 'ok')
  check('read vault rỗng → []', readOutcomes(fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-empty-'))).length === 0)
}

// ── groupByModel math ──
{
  const stats = groupByModel([mk('x', 'good'), mk('x', 'good'), mk('x', 'bad'), mk('y', 'bad')])
  const x = stats.find((s) => s.model === 'x')!
  check('group x: 2 good/1 bad → score 67%', x.good === 2 && x.bad === 1 && x.total === 3 && x.score === 67, JSON.stringify(x))
  const y = stats.find((s) => s.model === 'y')!
  check('group y: 0 good → score 0%', y.score === 0)
  check('sort theo total desc', stats[0].model === 'x')
}

// ── pickLearnedModel ──
{
  const cands = ['head', 'alt']
  // data ít → giữ head
  check('chưa đủ data → head (hardcode)', pickLearnedModel(cands, groupByModel([mk('alt', 'good')])).modelKey === 'head')
  // alt đủ MIN_SAMPLES toàn good, head no-data → override sang alt
  const altGood = Array.from({ length: MIN_SAMPLES }, () => mk('alt', 'good'))
  const p1 = pickLearnedModel(cands, groupByModel(altGood))
  check('alt đủ data + head no-data → override alt (learned)', p1.modelKey === 'alt' && p1.learned === true, JSON.stringify(p1))
  // head có data score cao, alt thấp → giữ head
  const mixed = [...Array.from({ length: MIN_SAMPLES }, () => mk('head', 'good')), ...Array.from({ length: MIN_SAMPLES }, () => mk('alt', 'bad'))]
  const p2 = pickLearnedModel(cands, groupByModel(mixed))
  check('head tốt hơn alt → giữ head', p2.modelKey === 'head' && p2.learned === false, JSON.stringify(p2))
  // head kém, alt hơn margin → override
  const flip = [
    ...Array.from({ length: MIN_SAMPLES }, () => mk('head', 'bad')),
    ...Array.from({ length: MIN_SAMPLES }, () => mk('alt', 'good')),
  ]
  const p3 = pickLearnedModel(cands, groupByModel(flip))
  check('head kém + alt hơn margin → override alt', p3.modelKey === 'alt' && p3.learned === true, JSON.stringify(p3))
  // best chỉ là head → không tính learned
  const headOnly = Array.from({ length: MIN_SAMPLES }, () => mk('head', 'good'))
  check('chỉ học head → learned=false', pickLearnedModel(cands, groupByModel(headOnly)).learned === false)
  // candidates rỗng an toàn
  check('candidates rỗng → undefined head, không crash', pickLearnedModel([], []).learned === false)
}

// ── routeTask học từ outcomes ──
{
  const caller = async () => '{"role":"reasoning","reason":"suy luận","needsTools":false,"confidence":0.8}'
  const role = 'reasoning'
  const [head, alt] = ROUTE_TABLE[role]
  // không outcomes → con đầu bảng
  const base = await routeTask('giải thích X', { caller })
  check('routeTask không data → con đầu bảng', base.modelKey === head && !base.learned, base.modelKey)
  // alt thắng đậm → routeTask chọn alt + learned
  const winAlt = [
    ...Array.from({ length: MIN_SAMPLES }, () => mk(head, 'bad')),
    ...Array.from({ length: MIN_SAMPLES }, () => mk(alt, 'good')),
  ]
  const learned = await routeTask('giải thích X', { caller, outcomes: groupByModel(winAlt) })
  check('routeTask học → chọn alt thắng', learned.modelKey === alt && learned.learned === true, JSON.stringify({ k: learned.modelKey, l: learned.learned }))
  check('reason có ghi vết learned', /learned/.test(learned.reason), learned.reason)
}

// cleanup
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* */ }

console.log(`\n${fail === 0 ? '✅' : '❌'} smoke:routing — ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
