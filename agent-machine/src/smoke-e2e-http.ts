// smoke-e2e-http (F5) — E2E THẬT đi trọn pipeline qua HTTP: coordinator ↔ worker (claim/submit) ↔ gate/approve.
// KHÔNG cần API key: runner = MockRunner (deterministic). Khác smoke-e2e (cần claude+lane key) — cái này chạy được trong CI.
// Chuỗi: POST /card → worker claim qua HTTP (workerStep thật) → submit → advance → gate review → POST /approve → done.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { loadConfig } from './config'
import { startCoordinator } from './coordinator'
import { workerStep } from './worker'
import type { Runner } from './runner'
import type { Card, Stage, Persona, RunResult } from './types'

// MockRunner: viết file marker vào ws (mô phỏng executor làm việc thật) → outcome 'done'.
class MockRunner implements Runner {
  async run(_c: Card, s: Stage, p: Persona, ws: string): Promise<RunResult> {
    fs.writeFileSync(path.join(ws, 'index.html'), '<h1>Lucy E2E-HTTP OK</h1>')
    return { outcome: { decision: 'done', summary: `mock ${p.name} xong "${s.name}"` }, cost: { usd: 0.001, inTok: 10, outTok: 10 }, raw: '' }
  }
}

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✅ ' + m) } else { fail++; console.log('  ❌ ' + m) } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-e2e-http-'))
const store = new Store(path.join(root, '.data'))
loadConfig(store, path.join(process.cwd(), 'config'))
const engine = new Engine(store, new MockRunner(), new Budget({ windowMs: 3600e3, capUsd: 5, softUsd: 4 }), { maxLanes: 1, perCardMaxUsd: 5, maxStageVisits: 2 })

const TOKEN = 'e2e-test-token'
const { server, stop } = startCoordinator(engine, store, 0, { token: TOKEN, host: '127.0.0.1', autoTickMs: 50 })

async function main() {
  await new Promise<void>((resolve) => server.on('listening', () => resolve()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  const base = `http://127.0.0.1:${port}`
  const H = { 'content-type': 'application/json', 'x-worker-token': TOKEN }
  const api = async (p: string, body?: unknown) => {
    const r = await fetch(base + p, body === undefined ? { headers: H } : { method: 'POST', headers: H, body: JSON.stringify(body) })
    return r.json() as any
  }

  console.log(`▶ E2E-HTTP — coordinator :${port}, token-guarded. pipeline 'blog' (build → review[gate]).`)

  // 0) auth: thiếu token → 401
  const noAuth = await fetch(base + '/state')
  ok(noAuth.status === 401, 'GET /state KHÔNG token → 401 (auth sống)')

  // 1) tạo card qua HTTP
  const created = await api('/card', { title: 'E2E HTTP card', brief: 'tạo index.html', pipelineId: 'blog', projectId: 'e2e' })
  const cardId = created?.card?.id
  ok(!!cardId, `POST /card → card id ${cardId}`)

  // 2) drive worker (claim/run/submit qua HTTP THẬT) + auto-approve gate
  const runner = new MockRunner()
  const localRoot = path.join(root, 'worker')
  let approved = 0
  let finalStatus = ''
  for (let i = 0; i < 60; i++) {
    const did = await workerStep(base, runner, { token: TOKEN, localRoot })
    if (did) continue
    const st = await api('/state')
    const c = (st.cards || []).find((x: Card) => x.id === cardId)
    if (!c) { await sleep(30); continue }
    if (c.status === 'done' || c.status === 'failed') { finalStatus = c.status; break }
    if (c.status === 'waiting_human' && c.waitKind === 'gate') { await api('/approve', { cardId, actor: 'lucy' }); approved++; continue }
    await sleep(30) // chờ auto-tick dispatch
  }

  ok(finalStatus === 'done', `card kết thúc DONE (status=${finalStatus || '?'})`)
  ok(approved >= 1, `gate review được approve qua HTTP (${approved} lần)`)

  // 3) artifact THẬT do worker tạo trên đĩa local
  const wsFile = path.join(localRoot, cardId, 'index.html')
  const made = fs.existsSync(wsFile) ? fs.readFileSync(wsFile, 'utf8') : ''
  ok(/Lucy E2E-HTTP OK/.test(made), 'worker tạo index.html thật trong workspace local')

  // 4) cost/ledger được cộng qua submit
  const st2 = await api('/state')
  const c2 = (st2.cards || []).find((x: Card) => x.id === cardId)
  ok(!!c2 && c2.cost.usd > 0, `cost cộng dồn qua /worker/result (usd=${c2?.cost?.usd})`)
}

main()
  .then(() => { stop(); fs.rmSync(root, { recursive: true, force: true }); console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`); process.exit(fail === 0 ? 0 : 1) })
  .catch((e) => { stop(); console.error('❌ E2E-HTTP crash:', e); process.exit(1) })
