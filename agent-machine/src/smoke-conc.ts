// Smoke concurrency/queue — (1) song song cap N, (2) STACK khi cap đầy (không drop),
// (3) chỉnh limits DYNAMIC lúc đang chạy. No token burn. Exit 1 nếu fail.
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import { startCoordinator } from './coordinator'
import { runWorker, workerStep } from './worker'
import type { Outcome, RunResult } from './types'

let pass = 0
let fail = 0
const check = (n: string, c: boolean, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${e}`) } }
const sleep = (ms: number) => new Promise((s) => setTimeout(s, ms))
const TOKEN = 'conc'
const oneStage = (store: Store) => {
  store.registerPersona({ id: 'eng', name: 'Eng', systemPrompt: 'x', model: 'sonnet' })
  store.registerPipeline({ id: 'one', name: 'One', stages: [{ id: 'fix', name: 'Fix', personaId: 'eng' }] })
}
const doneRunner = (delayMs = 0) => {
  const r = new MockRunner({ fix: { decision: 'done', summary: 'done' } } as Record<string, Outcome>)
  ;(r as any).run = async (): Promise<RunResult> => { if (delayMs) await sleep(delayMs); return { outcome: { decision: 'done', summary: 'done' }, cost: { usd: 0.001, inTok: 1, outTok: 1 }, raw: '' } }
  return r
}
const clean = (p: string) => fs.rmSync(p, { recursive: true, force: true })

// ── T1: song song cap 2 nhanh hơn tuần tự ──
async function tParallel() {
  console.log('\nC1 — worker cap 2 chạy SONG SONG')
  const PORT = 8794, URL = `http://127.0.0.1:${PORT}`
  const dir = path.join(process.cwd(), '.smoke-conc-1'); clean(dir); clean(path.join(process.cwd(), '.worker'))
  const store = new Store(dir); oneStage(store)
  const engine = new Engine(store, doneRunner(), new Budget({ windowMs: 5 * 3600e3, capUsd: 99 }), { maxLanes: 8 })
  const co = startCoordinator(engine, store, PORT, { token: TOKEN }); await sleep(100)
  for (let i = 0; i < 4; i++) engine.createCard(`j${i}`, 'b', 'one')
  while (engine.tick() > 0) { /* dispatch hết */ }
  const t0 = Date.now()
  await runWorker(URL, doneRunner(120), { token: TOKEN, concurrency: 2, stopWhenIdle: true, localRoot: path.join(process.cwd(), '.worker') })
  const elapsed = Date.now() - t0
  const st = await (await fetch(URL + '/state', { headers: { 'x-worker-token': TOKEN } })).json()
  check('4 card DONE', st.cards.filter((c: any) => c.status === 'done').length === 4)
  check(`song song nhanh hơn tuần tự (${elapsed}ms < 440ms)`, elapsed < 440, `(${elapsed}ms)`)
  co.stop(); clean(dir)
}

// ── T2: STACK — cap 1, nhắn 3 lần liên tiếp -> xếp hàng chạy lần lượt, KHÔNG drop ──
async function tStack() {
  console.log('\nC2 — STACK: cap 1, 3 việc liên tiếp -> xếp hàng chạy sau (không drop)')
  const PORT = 8795, URL = `http://127.0.0.1:${PORT}`
  const dir = path.join(process.cwd(), '.smoke-conc-2'); clean(dir); clean(path.join(process.cwd(), '.worker'))
  const store = new Store(dir); oneStage(store)
  const engine = new Engine(store, doneRunner(), new Budget({ windowMs: 5 * 3600e3, capUsd: 99 }), { maxLanes: 1 })
  const co = startCoordinator(engine, store, PORT, { token: TOKEN }); await sleep(100)
  // "người dùng nhắn 3 lần" khi đang bận
  const ids = [0, 1, 2].map((i) => engine.createCard(`msg${i}`, 'b', 'one').id)
  let maxInFlight = 0
  for (let round = 0; round < 12; round++) {
    engine.tick()
    maxInFlight = Math.max(maxInFlight, engine.limits().inFlight)
    while (await workerStep(URL, doneRunner(), { token: TOKEN, localRoot: path.join(process.cwd(), '.worker') })) { /* drain */ }
    if (ids.every((id) => store.getCard(id)!.status === 'done')) break
  }
  check('cap 1: không bao giờ >1 chạy cùng lúc', maxInFlight <= 1, `(maxInFlight=${maxInFlight})`)
  check('cả 3 việc ĐỀU chạy (stack, không drop)', ids.every((id) => store.getCard(id)!.status === 'done'))
  co.stop(); clean(dir)
}

// ── T3: DYNAMIC — chỉnh maxLanes lúc đang chạy qua /config ──
async function tDynamic() {
  console.log('\nC3 — DYNAMIC: chỉnh queue width (maxLanes) lúc đang chạy')
  const PORT = 8796, URL = `http://127.0.0.1:${PORT}`
  const dir = path.join(process.cwd(), '.smoke-conc-3'); clean(dir)
  const store = new Store(dir); oneStage(store)
  const engine = new Engine(store, doneRunner(), new Budget({ windowMs: 5 * 3600e3, capUsd: 99 }), { maxLanes: 2 })
  const co = startCoordinator(engine, store, PORT, { token: TOKEN }); await sleep(100)
  const hdr = { 'content-type': 'application/json', 'x-worker-token': TOKEN }
  const c0 = await (await fetch(URL + '/config', { headers: hdr })).json()
  check('GET /config trả maxLanes hiện tại', c0.maxLanes === 2, `(got ${c0.maxLanes})`)
  const c1 = await (await fetch(URL + '/config', { method: 'POST', headers: hdr, body: JSON.stringify({ maxLanes: 5 }) })).json()
  check('POST /config tăng maxLanes -> 5 (dynamic)', c1.maxLanes === 5 && engine.maxLanes === 5)
  const bad = await fetch(URL + '/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  check('/config thiếu token -> 401', bad.status === 401, `(got ${bad.status})`)
  co.stop(); clean(dir)
}

async function main() {
  console.log('🧪 concurrency/queue smoke (no token burn)')
  await tParallel(); await tStack(); await tDynamic()
  clean(path.join(process.cwd(), '.worker'))
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
