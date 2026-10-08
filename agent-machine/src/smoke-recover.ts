// Smoke recovery — coordinator "crash" giữa lúc card đang chạy -> restart KHÔNG mất việc.
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import { loadConfig } from './config'
import type { Outcome } from './types'

let pass = 0
let fail = 0
const check = (n: string, c: boolean, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${e}`) } }
const CONFIG = path.join(process.cwd(), 'config')
const script: Record<string, Outcome> = {
  draft: { decision: 'delegate', summary: 'stuck', delegateTo: { personaId: 'engineer', title: 'Fix', brief: 'x', pipelineId: 'eng' } },
  fix: { decision: 'done', summary: 'fixed' }, review: { decision: 'advance', summary: 'reviewed' }, ship: { decision: 'advance', summary: 'shipped' },
}
const budget = () => new Budget({ windowMs: 5 * 3600e3, capUsd: 99 })

async function main() {
  console.log('🧪 recovery smoke (no token burn)')
  const dir = path.join(process.cwd(), '.smoke-recover'); fs.rmSync(dir, { recursive: true, force: true })

  // ── session 1: dispatch 1 card rồi "rớt" (không drain -> card kẹt 'working') ──
  const s1 = new Store(dir); loadConfig(s1, CONFIG)
  const e1 = new Engine(s1, new MockRunner(script), budget(), {})
  const card = e1.createCard('Crash test', 'b', 'course')
  e1.tick() // dispatch draft -> working (chưa chạy xong)
  check('card đang ở "working" (đã dispatch)', s1.getCard(card.id)!.status === 'working', `(${s1.getCard(card.id)!.status})`)
  check('cards.json persist trên đĩa', fs.existsSync(path.join(dir, 'cards.json')))

  // ── "RESTART": store/engine mới, cùng data dir (in-memory queue mất) ──
  const s2 = new Store(dir); loadConfig(s2, CONFIG)
  const e2 = new Engine(s2, new MockRunner(script), budget(), {})
  check('sau restart: card load lại = "working" (mồ côi)', s2.getCard(card.id)!.status === 'working')
  const n = e2.recover()
  check('recover() đưa card mồ côi -> queued', n >= 1 && s2.getCard(card.id)!.status === 'queued', `(n=${n}, status=${s2.getCard(card.id)!.status})`)

  // ── chạy tiếp: card KHÔNG mất, đi tới gate ──
  await e2.runUntilIdle()
  const fin = s2.getCard(card.id)!.status
  check('card chạy tiếp sau restart (không kẹt working)', fin !== 'working', `(${fin})`)
  check('card tiến tới chỗ chờ duyệt (waiting_human)', fin === 'waiting_human', `(${fin})`)

  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
