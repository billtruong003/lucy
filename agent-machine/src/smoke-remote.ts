// Remote smoke — chứng minh TOPOLOGY: coordinator(HTTP) + worker quay-ra (claim/run/submit qua HTTP).
// Vẫn MockRunner (không đốt token). Exit 1 nếu fail.
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import { loadConfig } from './config'
import { startCoordinator } from './coordinator'
import { workerStep } from './worker'
import type { Outcome } from './types'

let pass = 0
let fail = 0
const check = (n: string, c: boolean, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${e}`) } }
const sleep = (ms: number) => new Promise((s) => setTimeout(s, ms))

const PORT = Number(process.env.AM_PORT || 8791)
const URL = `http://127.0.0.1:${PORT}`
const TOKEN = 'smoke-token'
const CONFIG = path.join(process.cwd(), 'config')

const script: Record<string, Outcome> = {
  draft: { decision: 'delegate', summary: 'stuck web', delegateTo: { personaId: 'engineer', title: 'Fix render', brief: 'fix', pipelineId: 'eng' } },
  fix: { decision: 'done', summary: 'fixed' },
  review: { decision: 'advance', summary: 'reviewed' },
  ship: { decision: 'advance', summary: 'shipped' },
}

const headers = { 'content-type': 'application/json', 'x-worker-token': TOKEN }
const getState = async () => (await (await fetch(URL + '/state', { headers: { 'x-worker-token': TOKEN } })).json()) as { cards: any[]; channels: any[] }

// worker runner riêng (giả lập máy local) — coordinator KHÔNG dùng runner để chạy
const workerRunner = new MockRunner(script)
async function drive(rounds: number, stopOn: (cards: any[]) => boolean) {
  for (let i = 0; i < rounds; i++) {
    await fetch(URL + '/tick', { method: 'POST', headers: { 'x-worker-token': TOKEN } })
    while (await workerStep(URL, workerRunner, { token: TOKEN, localRoot: path.join(process.cwd(), '.worker') })) { /* drain */ }
    const st = await getState()
    if (stopOn(st.cards)) return
  }
}

async function main() {
  console.log('🧪 remote smoke — coordinator(HTTP) + worker dial-out (no token burn)')
  const dir = path.join(process.cwd(), '.smoke-remote'); fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(path.join(process.cwd(), '.worker'), { recursive: true, force: true })
  const store = new Store(dir)
  const loaded = loadConfig(store, CONFIG)
  const engine = new Engine(store, new MockRunner(script), new Budget({ windowMs: 5 * 3600e3, capUsd: 5 }), { perCardMaxUsd: 5 })
  const co = startCoordinator(engine, store, PORT, { token: TOKEN })
  await sleep(150)

  check('config nạp ok', loaded.personas >= 3 && loaded.pipelines >= 2)

  // worker không có token -> bị chặn 401
  const bad = await fetch(URL + '/worker/claim', { method: 'POST' })
  check('worker thiếu token -> 401', bad.status === 401, `(got ${bad.status})`)

  // tạo card qua HTTP
  const cr = await (await fetch(URL + '/card', { method: 'POST', headers, body: JSON.stringify({ title: 'Course HTML', brief: 'b', pipelineId: 'course' }) })).json()
  check('tạo card qua HTTP', !!cr.card?.id)

  // chạy tới khi kẹt gate (worker quay-ra xử lý qua HTTP)
  await drive(40, (cards) => cards.some((c) => c.status === 'waiting_human'))
  let st = await getState()
  const gate = st.cards.find((c) => c.status === 'waiting_human')
  check('card kẹt GATE qua remote path', !!gate, `(statuses: ${st.cards.map((c) => c.status).join(',')})`)
  check('child engineer DONE (hold/resume qua HTTP)', st.cards.some((c) => c.parentId === cr.card.id && c.status === 'done'))

  // duyệt qua HTTP -> chạy nốt
  if (gate) await fetch(URL + '/approve', { method: 'POST', headers, body: JSON.stringify({ cardId: gate.id }) })
  await drive(20, (cards) => cards.find((c) => c.pipelineId === 'course')?.status === 'done')
  st = await getState()
  const main2 = st.cards.find((c) => c.pipelineId === 'course')
  check('card chính DONE qua remote path', main2?.status === 'done', `(got ${main2?.status})`)
  check('channels có log qua coordinator', st.channels.length >= 6, `(got ${st.channels.length})`)

  co.stop()
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
