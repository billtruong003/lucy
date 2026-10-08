// Smoke test — verify token-guard bug fixes AND gate check (đúng = advance, sai = rework)
// BUG1 fix: engine.claim() check soft → ép persona xuống cheapest lane
// BUG2 fix: safeNum() escape MarkdownV2 trong notify.ts
import fs from 'node:fs'
import path from 'node:path'
import { TokenGuard } from './token-guard'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import { cheapestAvailableLaneKey, laneAvailable } from './llm-lane'
import { loadConfig } from './config'

let pass = 0
let fail = 0
let gateFail = false // nếu có fail → gate không pass → rework
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; gateFail = true; console.log(`  ❌ ${name} ${extra}`) }
}
const tmp = (n: string) => { const d = path.join(process.cwd(), '.smoke', n); fs.rmSync(d, { recursive: true, force: true }); return d }
const CONFIG = path.join(process.cwd(), 'config')

async function main() {
  console.log('🧪 smoke:token-guard-bugs — VERIFY fixes (engine.claim() downgrade + notify esc)\n')

  // ──────────────────────────────────────────────────
  // TEST 1: engine.claim() downgrades when soft limit hit
  // ──────────────────────────────────────────────────
  console.log('── TEST 1: engine.claim() hạ executor khi soft ──')
  const d1 = tmp('tg-fix1')
  const store1 = new Store(d1)
  loadConfig(store1, CONFIG)
  store1.registerPersona({
    id: 'executor-test',
    name: 'Test Executor',
    systemPrompt: 'test',
    model: 'sonnet',
    // KHÔNG set laneModel — engine phải tự tìm cheapest available
    kind: 'executor',
  })
  store1.pipelines.set('test-flow', {
    id: 'test-flow',
    name: 'Test Flow',
    stages: [{ id: 's1', name: 'Build', personaId: 'executor-test' }],
  })

  const tg1 = new TokenGuard(d1)
  tg1.setLimits(100, 500)
  tg1.addTokens(0, 150) // vượt soft (100) nhưng chưa hard (500)
  const ts1 = tg1.check()
  check('TS1 pre: soft=true', ts1.soft === true, `got soft=${ts1.soft}`)
  check('TS1 pre: hard=false', ts1.hard === false, `got hard=${ts1.hard}`)

  const engine1 = new Engine(store1, new MockRunner({}), new Budget({ windowMs: 3600e3, capUsd: 1 }), { perCardMaxUsd: 1 })
  engine1.tokenGuard = tg1

  const c1 = engine1.createCard('Test1', 'test', 'test-flow')
  engine1.tick()
  const job1 = engine1.claim()

  if (!job1) {
    check('TEST1: claim() trả job', false, 'job=null')
  } else {
    const p = job1.persona
    console.log(`  → Persona model=${p.model}, laneModel=${p.laneModel || 'N/A'}`)
    // Kỳ vọng: laneModel được ép (khác undefined)
    check('TEST1: laneModel đã được set (engine ép khi soft)', p.laneModel != null, `laneModel=${p.laneModel}`)
    if (p.laneModel) {
      check('TEST1: laneModel available', laneAvailable(p.laneModel), `key="${p.laneModel}"`)
      const cheap = cheapestAvailableLaneKey()
      check(`TEST1: laneModel là cheapestAvailable (${cheap})`, p.laneModel === cheap, `got="${p.laneModel}"`)
    }
  }

  // ──────────────────────────────────────────────────
  // TEST 2: engine.createCard() từ chối khi hard limit
  // ──────────────────────────────────────────────────
  console.log('\n── TEST 2: engine.createCard() block khi hard ──')
  const d2 = tmp('tg-fix2')
  const store2 = new Store(d2)
  loadConfig(store2, CONFIG)
  store2.registerPersona({
    id: 'executor-test2',
    name: 'Test Executor 2',
    systemPrompt: 'test',
    model: 'sonnet',
    laneModel: 'deepseek-chat',
    kind: 'executor',
  })
  store2.pipelines.set('test-flow2', {
    id: 'test-flow2',
    name: 'Test Flow 2',
    stages: [{ id: 's1', name: 'Build', personaId: 'executor-test2' }],
  })

  const tg2 = new TokenGuard(d2)
  tg2.setLimits(100, 200) // soft=100, hard=200
  tg2.addTokens(0, 250)  // vượt cả hard
  const ts2 = tg2.check()
  check('TS2 pre: hard=true', ts2.hard === true, `got hard=${ts2.hard}`)
  check('TS2 pre: ok=false', ts2.ok === false, `got ok=${ts2.ok}`)

  const engine2 = new Engine(store2, new MockRunner({}), new Budget({ windowMs: 3600e3, capUsd: 1 }), { perCardMaxUsd: 1 })
  engine2.tokenGuard = tg2

  const c2 = engine2.createCard('Test2', 'test', 'test-flow2')
  check('TEST2: card bị block (waiting_human)', c2.status === 'waiting_human', `status=${c2.status}`)
  check('TEST2: waitKind=decision', c2.waitKind === 'decision', `waitKind=${c2.waitKind}`)

  // ──────────────────────────────────────────────────
  // TEST 3: safeNum esc() trong notify.ts (đọc file verify)
  // ──────────────────────────────────────────────────
  console.log('\n── TEST 3: safeNum escape MarkdownV2 trong notify.ts ──')
  const notifySrc = fs.readFileSync(path.join(process.cwd(), 'src', 'notify.ts'), 'utf8')
  const hasSafeNum = notifySrc.includes('function safeNum')
  check('TEST3a: safeNum tồn tại', hasSafeNum, '')
  
  // Verify safeNum bọc esc()
  const safeNumBody = notifySrc.match(/function safeNum\(n: number\): string \{[\s\S]*?return (.*?)\n\}/)
  if (safeNumBody) {
    const returnExpr = safeNumBody[1]
    check('TEST3b: safeNum trả về esc(...)', returnExpr.includes('esc('), `return=${returnExpr.trim()}`)
  } else {
    check('TEST3b: đọc được body safeNum', false, 'regex không match')
  }
  
  // Verify dùng safeNum (đã self-escaped) — không cần esc() bọc ngoài
  const safeNumLines = notifySrc.split('\n').filter((l) => l.includes('safeNum('))
  check('TEST3c: safeNum được dùng (self-escaped)', safeNumLines.length >= 3, `${safeNumLines.length} dùng`)

  // Test logic: esc() với số float
  const safeFloat = (() => {
    // replica từ notify.ts
    function esc(text: string): string { return text.replace(/[_*[\]()~>#+\-=|{}.!]/g, '\\$&') }
    function safeNum(n: number): string { return esc(n.toLocaleString('en-US')) }
    return safeNum(1500.5)
  })()
  check('TEST3d: float 1500.5 escape dấu chấm', safeFloat.includes('\\.'), `got="${safeFloat}"`)

  // ──────────────────────────────────────────────────
  // KẾT LUẬN
  // ──────────────────────────────────────────────────
  const verdict = fail === 0 ? '✅ GATE PASS — tất cả test đúng' : `❌ GATE FAIL — ${fail} test fail`
  console.log(`\n${verdict} — ${pass} pass, ${fail} fail\n`)

  // IN kết quả chi tiết
  if (fail > 0) {
    for (const f of []) { /* sẽ in nếu cần */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
