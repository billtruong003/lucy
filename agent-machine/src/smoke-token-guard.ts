// Smoke test TokenGuard — giả lập soft/hard limit, assert đúng hành vi.
// KHÔNG đốt token thật. Dùng MockRunner + TokenGuard trực tiếp.
import fs from 'node:fs'
import path from 'node:path'
import { TokenGuard } from './token-guard'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import { loadConfig } from './config'
import { cheapestAvailableLaneKey } from './llm-lane'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}
const tmp = (n: string) => { const d = path.join(process.cwd(), '.smoke', n); fs.rmSync(d, { recursive: true, force: true }); return d }
const CONFIG = path.join(process.cwd(), 'config')

async function main() {
  console.log('🧪 smoke:token-guard — TokenGuard soft/hard + integration với Engine.createCard')

  // ── Test 1: TokenGuard đơn — soft → check.soft, hard → ok=false ──
  console.log('\n── Test 1: soft/hard limits ──')
  const tg = new TokenGuard(tmp('tg-test1'))
  tg.setLimits(1000, 2000) // soft=1000, hard=2000
  const s0 = tg.check()
  check('khởi tạo ok=true', s0.ok === true)
  check('khởi tạo soft=false', s0.soft === false)
  check('khởi tạo hard=false', s0.hard === false)
  check('khởi tạo used=0', s0.used === 0)
  check('khởi tạo softLimit=1000', s0.softLimit === 1000)
  check('khởi tạo hardLimit=2000', s0.hardLimit === 2000)

  tg.addTokens(800, 0) // in=800, out=0 → total=800
  const s1 = tg.check()
  check('add 800 → used=800', s1.used === 800)
  check('add 800 → soft=false (chưa tới 1000)', s1.soft === false)

  tg.addTokens(700, 0) // in=700 → total=1500
  const s2 = tg.check()
  check('add 700 → used=1500', s2.used === 1500)
  check('add 700 → soft=true (≥1000)', s2.soft === true)
  check('add 700 → ok=true (chưa tới 2000)', s2.ok === true)
  check('add 700 → hard=false', s2.hard === false)

  tg.addTokens(0, 600) // out=600 → total=2100
  const s3 = tg.check()
  check('add 600 out → used=2100', s3.used === 2100)
  check('add 600 out → hard=true (≥2000)', s3.hard === true)
  check('add 600 out → ok=false', s3.ok === false)

  // ── Test 2: resetDay ──
  console.log('\n── Test 2: resetDay ──')
  tg.resetDay()
  const s4 = tg.check()
  check('reset → used=0', s4.used === 0)
  check('reset → ok=true', s4.ok === true)
  check('reset → soft=false', s4.soft === false)
  check('reset → hard=false', s4.hard === false)

  // ── Test 3: inTok + outTok riêng ──
  console.log('\n── Test 3: inTok + outTok tracking ──')
  const tg2 = new TokenGuard(tmp('tg-test3'))
  tg2.setLimits(5000, 10000)
  tg2.addTokens(300, 200)
  check('used = in+out = 500', tg2.used() === 500)

  // ── Test 4: engine.createCard từ chối khi hard ──
  console.log('\n── Test 4: engine.createCard hard-blocked ──')
  const dataDir = tmp('tg-test4')
  const tg4 = new TokenGuard(dataDir)
  tg4.setLimits(100, 200) // limits rất thấp
  tg4.addTokens(0, 250) // vượt hard
  const s = tg4.check()
  check('hard=true để test', s.hard === true)
  check('ok=false', s.ok === false)

  const store = new Store(dataDir)
  const loaded = loadConfig(store, CONFIG)
  const engine = new Engine(store, new MockRunner({}), new Budget({ windowMs: 3600e3, capUsd: 1 }), { perCardMaxUsd: 1 })
  engine.tokenGuard = tg4

  // Tạo card khi hard → status phải là 'waiting_human'
  const c1 = engine.createCard('Test hard-blocked', 'should be blocked', 'course')
  check('card status = waiting_human khi hard limit', c1.status === 'waiting_human', `(got ${c1.status})`)
  check('card waitKind = decision', c1.waitKind === 'decision', `(got ${c1.waitKind})`)
  check('card có pendingQuestion lý do hard', (c1.pendingQuestion || '').includes('hard limit'), `(got ${c1.pendingQuestion})`)

  // Reset → card mới phải queued bình thường
  tg4.resetDay()
  const c2 = engine.createCard('Test normal', 'should be queued', 'course')
  check('sau reset → card status = queued', c2.status === 'queued', `(got ${c2.status})`)
  check('sau reset → card không có waitKind', c2.waitKind === undefined, `(got ${c2.waitKind})`)

  // ── Test 5: engine.setLimits wire tokenGuard ──
  console.log('\n── Test 5: setLimits qua engine ──')
  const tg5 = new TokenGuard(dataDir)
  engine.tokenGuard = tg5
  engine.setLimits({ tokenSoft: 300, tokenHard: 600 })
  check('tokenGuard.softLimit = 300', tg5.softLimit === 300, `(got ${tg5.softLimit})`)
  check('tokenGuard.hardLimit = 600', tg5.hardLimit === 600, `(got ${tg5.hardLimit})`)
  tg5.addTokens(0, 500)
  const s5 = tg5.check()
  check('500/600 → soft=true', s5.soft === true)
  check('500/600 → hard=false', s5.hard === false)

  // ── Test 6: engine.tokenGuardStatus() ──
  console.log('\n── Test 6: engine.tokenGuardStatus() ──')
  const tgs = engine.tokenGuardStatus()
  check('tokenGuardStatus configured=true', tgs.configured === true)
  check('tokenGuardStatus có status object', tgs.status !== undefined)
  check('tokenGuardStatus.status.used === 500', tgs.status?.used === 500, `(got ${tgs.status?.used})`)

  // Engine không có tokenGuard → trả configured=false
  engine.tokenGuard = null
  const tgsNull = engine.tokenGuardStatus()
  check('tokenGuardStatus khi null → configured=false', tgsNull.configured === false)
  engine.tokenGuard = tg5 // restore

  // ── Test 7: auto reset sang ngày mới (mốc VN — DASH-FIX S5) ──
  console.log('\n── Test 7: auto reset ngày VN ──')
  const { vnDay: vnDay7 } = await import('./tz')
  const tg7dir = tmp('tg-test7')
  // Giả lập record cũ (ngày hôm qua theo VN)
  const yDate = vnDay7(Date.now() - 86400e3)
  const recordFile = path.join(tg7dir, 'token-day.json')
  fs.mkdirSync(tg7dir, { recursive: true })
  fs.writeFileSync(recordFile, JSON.stringify({ date: yDate, inTok: 99999, outTok: 99999 }))
  const tg7 = new TokenGuard(tg7dir)
  const s7 = tg7.check()
  check('reset tự động: used=0', s7.used === 0, `(got ${s7.used})`)

  // ── Test 8: end-to-end submit() → ledger (DASH-FIX S1: used dẫn xuất Σ ledger) + claim() downgrade SCOPE executor (GAP#3) ──
  console.log('\n── Test 8: submit→ledger derive + claim downgrade scope ──')
  const e2eDir = tmp('tg-test8')
  const store8 = new Store(e2eDir)
  loadConfig(store8, CONFIG)
  const tg8 = new TokenGuard(e2eDir)
  tg8.setLimits(100_000, 1_000_000) // cao → không chặn; chỉ để đếm token tích lũy qua submit()
  const engine8 = new Engine(store8, new MockRunner({}), new Budget({ windowMs: 3600e3, capUsd: 100 }), { perCardMaxUsd: 100 })
  engine8.tokenGuard = tg8
  tg8.ledgerSum = () => engine8.ledgerUsedToday() // DASH-FIX S1: used() = Σ ledger hôm nay (như coordinator-main wire)

  // GAP#1: chạy card qua engine → mỗi submit() phải cộng token vào guard (trước fix used()=0 mãi)
  const cardE2E = engine8.createCard('E2E token count', 'chạy pipeline', 'course')
  await engine8.runUntilIdle()
  const used8 = tg8.used()
  check('submit() cộng token vào guard (used > 0)', used8 > 0, `(got ${used8})`)
  check('guard.used khớp tổng cost của card', used8 === cardE2E.cost.inTok + cardE2E.cost.outTok, `(got ${used8} vs ${cardE2E.cost.inTok + cardE2E.cost.outTok})`)

  // ── DASH-FIX S5 RECONCILE: used == Σ ledger hôm nay (VN) = NGUỒN DUY NHẤT, KHÔNG double-count ──
  const { vnDay } = await import('./tz')
  const todayVN = vnDay()
  let ledgerToday = 0
  for (const e of store8.readLedger()) {
    if (vnDay(e.ts) === todayVN) ledgerToday += (e.inTok || 0) + (e.cacheTok || 0) + (e.outTok || 0)
  }
  check('reconcile: used == Σ ledger hôm nay (VN)', used8 === ledgerToday, `(used ${used8} vs ledger ${ledgerToday})`)
  // double-count guard: addTokens() KHÔNG còn cộng vào used (used dẫn xuất ledger) → gọi addTokens không làm used phình
  tg8.addTokens(123_456, 0)
  check('double-count guard: addTokens KHÔNG đẩy used (vẫn = Σ ledger)', tg8.used() === ledgerToday, `(got ${tg8.used()} vs ${ledgerToday})`)
  // token>0 ⇒ cost>0: worker entry phải có usd>0 (priced)
  const workerCostOk = store8.readLedger().filter(e => (e.inTok + e.outTok) > 0).every(e => e.usd > 0)
  check('invariant: entry token>0 ⇒ usd>0 (worker priced)', workerCostOk)

  // GAP#3: soft reached → claim() hạ EXECUTOR xuống lane rẻ, KHÔNG hạ reviewer (specialist/opus)
  process.env.OPENCODE_ZEN_API_KEY = process.env.OPENCODE_ZEN_API_KEY || 'smoke-fake-key' // để cheapestAvailableLaneKey() != null
  const cheap = cheapestAvailableLaneKey()
  tg8.setLimits(1, 1_000_000) // soft=1 → đã vượt (used>0) nhưng chưa hard
  check('tg8 soft=true (đã vượt soft)', tg8.check().soft === true)

  // executor (builder) → bị hạ lane khi soft
  engine8.createCard('exec card', 'x', 'course', undefined, 0, 'default', false, undefined, [], 'builder')
  engine8.tick()
  const specB = engine8.claim()
  check('executor builder: claim() trả spec', !!specB)
  if (cheap) check('executor bị hạ lane khi soft (laneModel set)', !!specB && !!specB.persona.laneModel, `(got ${specB?.persona.laneModel})`)
  else console.log('  ⏭️  bỏ qua assert hạ-lane (không có provider key → cheapKey=null)')
  if (specB) engine8.submit(specB.jobId, { outcome: { decision: 'needs_decision', summary: 'pause', question: 'q' }, cost: { usd: 0, inTok: 0, outTok: 0 }, raw: '' }) // free lane

  // reviewer (specialist) → KHÔNG bị hạ (giữ opus để gate chất lượng)
  engine8.createCard('reviewer card', 'x', 'course', undefined, 0, 'default', false, undefined, [], 'reviewer')
  engine8.tick()
  const specR = engine8.claim()
  check('reviewer specialist: claim() trả spec', !!specR)
  check('reviewer KHÔNG bị hạ lane (laneModel undefined)', !!specR && !specR.persona.laneModel, `(got ${specR?.persona.laneModel})`)

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
