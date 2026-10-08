// Smoke test metrics — assert buildMetrics trả số thật sau 1 card chạy xong.
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import { loadConfig } from './config'
import { buildMetrics } from './metrics'
import type { Outcome } from './types'
import type { Recall } from './recall'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}
const tmp = (n: string) => { const d = path.join(process.cwd(), '.smoke', n); fs.rmSync(d, { recursive: true, force: true }); return d }
const CONFIG = path.join(process.cwd(), 'config')

const script: Record<string, Outcome> = {
  draft: { decision: 'delegate', summary: 'stuck', delegateTo: { personaId: 'engineer', title: 'Fix', brief: 'fix', pipelineId: 'eng' } },
  fix: { decision: 'done', summary: 'fixed' },
  review: { decision: 'advance', summary: 'reviewed' },
  ship: { decision: 'advance', summary: 'shipped' },
}

async function main() {
  console.log('🧪 smoke:metrics — buildMetrics() after 1 card run')
  const store = new Store(tmp('metrics'))
  const loaded = loadConfig(store, CONFIG)
  check('config nạp personas', loaded.personas >= 1)
  const engine = new Engine(store, new MockRunner(script), new Budget({ windowMs: 5 * 3600e3, capUsd: 5 }), { perCardMaxUsd: 5 })
  engine.createCard('Metrics test card', 'test brief', 'course')
  await engine.runUntilIdle()

  const m = buildMetrics(store)
  // console.log(JSON.stringify(m, null, 2)) // uncomment để debug

  check('totals.usd > 0', m.totals.usd > 0, `(got ${m.totals.usd})`)
  check('totals.inTok > 0', m.totals.inTok > 0, `(got ${m.totals.inTok})`)
  check('totals.outTok > 0', m.totals.outTok > 0, `(got ${m.totals.outTok})`)
  check('totals.runs > 0', m.totals.runs > 0, `(got ${m.totals.runs})`)
  check('totals.cards > 0', m.totals.cards > 0, `(got ${m.totals.cards})`)

  const dayCount = Object.keys(m.tokenByDay).length
  check('tokenByDay có ≥1 ngày', dayCount >= 1, `(got ${dayCount})`)

  const agentCount = Object.keys(m.costByAgent).length
  check('costByAgent có ≥1 agent', agentCount >= 1, `(got ${agentCount})`)

  const modelCount = Object.keys(m.costByModel).length
  check('costByModel có ≥1 model', modelCount >= 1, `(got ${modelCount})`)

  check('costByProject có "default"', !!m.costByProject['default'])

  // S4: costBySource — worker run phải vào nguồn 'worker'
  check('costBySource có "worker"', !!m.costBySource['worker'], `(keys: ${Object.keys(m.costBySource).join(',')})`)
  check('totals.cacheTok ≥ 0', m.totals.cacheTok >= 0, `(got ${m.totals.cacheTok})`)
  // S4 reconcile: Σ token costBySource == Σ token costByModel (cùng ledger, khác key)
  const sumSrc = Object.values(m.costBySource).reduce((s, g) => s + g.inTok + g.outTok + g.cacheTok, 0)
  const sumMod = Object.values(m.costByModel).reduce((s, g) => s + g.inTok + g.outTok + g.cacheTok, 0)
  check('Σ token costBySource == costByModel', sumSrc === sumMod, `(src ${sumSrc} vs mod ${sumMod})`)

  // ── DASH-FIX S5 RECONCILE invariants (Token/ngày ≤ Token/tháng · token>0 ⇒ cost>0) ──
  const { vnDay } = await import('./tz')
  const todayVN = vnDay()
  const monthPfx = todayVN.slice(0, 7)
  const tok = (d: { inTok: number; outTok: number; cacheTok: number }) => d.inTok + d.outTok + d.cacheTok
  let tokenDay = 0, tokenMonth = 0, costDay = 0, costMonth = 0
  for (const [day, d] of Object.entries(m.tokenByDay)) {
    if (day === todayVN) { tokenDay = tok(d); costDay = d.usd }
    if (day.startsWith(monthPfx)) { tokenMonth += tok(d); costMonth += d.usd }
  }
  check('invariant: Token/ngày ≤ Token/tháng', tokenDay <= tokenMonth, `(ngày ${tokenDay} > tháng ${tokenMonth})`)
  check('invariant: Cost/ngày ≤ Cost/tháng', costDay <= costMonth + 1e-9, `(ngày ${costDay} > tháng ${costMonth})`)
  // Σ costBySource.usd == Σ costByModel.usd (cùng ledger)
  const usdSrc = Object.values(m.costBySource).reduce((s, g) => s + g.usd, 0)
  const usdMod = Object.values(m.costByModel).reduce((s, g) => s + g.usd, 0)
  check('reconcile: Σ usd costBySource == costByModel', Math.abs(usdSrc - usdMod) < 1e-9, `(src ${usdSrc} vs mod ${usdMod})`)
  // worker entry token>0 ⇒ cost>0 (priced); worker run của smoke phải có usd>0
  check('invariant: worker token>0 ⇒ usd>0', (m.costBySource['worker']?.inTok ?? 0) === 0 || (m.costBySource['worker']?.usd ?? 0) > 0)

  const tpDays = Object.keys(m.cardThroughput).length
  check('cardThroughput có ≥1 ngày', tpDays >= 1, `(got ${tpDays})`)
  const createdTotal = Object.values(m.cardThroughput).reduce((s, d) => s + d.created, 0)
  check('cardThroughput có created ≥1', createdTotal >= 1, `(got ${createdTotal})`)

  check('vault là null (không có recall)', m.vault === null)

  // vault với mock recall — notes = total, observations = observations
  const mockRecall = { stats: () => ({ total: 7, observations: 4 }) }
  const mVault = buildMetrics(store, mockRecall as unknown as Recall)
  check('vault non-null khi có recall', mVault.vault !== null)
  check('vault.notes = 7', mVault.vault?.notes === 7, `(got ${mVault.vault?.notes})`)
  check('vault.observations = 4', mVault.vault?.observations === 4, `(got ${mVault.vault?.observations})`)

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
