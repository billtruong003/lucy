// Dev seed — coordinator + worker mock + demo cards, để XEM Board/Channels có data sống.
// Chạy: npm run seed  (port 8780, token devtoken). KHÔNG đốt token (MockRunner).
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import { loadConfig } from './config'
import { startCoordinator } from './coordinator'
import { runWorker } from './worker'
import type { Outcome } from './types'

const PORT = Number(process.env.AM_PORT || 8780)
const TOKEN = process.env.AM_TOKEN || 'devtoken'
const dir = path.join(process.cwd(), '.data-seed')
fs.rmSync(dir, { recursive: true, force: true })
fs.rmSync(path.join(process.cwd(), '.worker'), { recursive: true, force: true })

const store = new Store(dir)
loadConfig(store, path.join(process.cwd(), 'config'))

const script: Record<string, Outcome> = {
  draft: { decision: 'delegate', summary: 'Đang giã docs HTML/CSS/Vue — STUCK: web không render, nhờ engineer', delegateTo: { personaId: 'engineer', title: 'Fix render web', brief: 'web không render', pipelineId: 'eng' } },
  fix: { decision: 'done', summary: 'Đã fix render (component + build). Functional ✓' },
  review: { decision: 'advance', summary: 'Review xong, mọi tag functional — chờ Bill mark OK' },
  ship: { decision: 'advance', summary: 'Đã xuất bản course lên portal' },
}
const engine = new Engine(store, new MockRunner(script), new Budget({ windowMs: 5 * 3600e3, capUsd: 20, softUsd: 14 }), { maxLanes: 3, perCardMaxUsd: 5 })
startCoordinator(engine, store, PORT, { token: TOKEN, autoTickMs: 600 })
console.log(`🌱 seed coordinator: http://127.0.0.1:${PORT}  (token=${TOKEN}) — đang chạy demo cards...`)

// tạo card rải theo thời gian, dưới NHIỀU dự án -> board scope theo project
const demo: [string, string][] = [
  ['Course HTML cơ bản', 'Portal học'],
  ['Course CSS Flexbox', 'Portal học'],
  ['Course Vue căn bản', 'Portal học'],
  ['Refactor engine queue', 'Lucy core'],
  ['Viết test coordinator', 'Lucy core'],
]
demo.forEach(([t, pj], i) => setTimeout(() => engine.createCard(t, 'Demo brief — viết + feature render web.', 'course', undefined, 0, pj), 1000 + i * 1500))

// worker mock (cap 2) lái card chạy — KHÔNG đốt token
runWorker(`http://127.0.0.1:${PORT}`, new MockRunner(script), { token: TOKEN, concurrency: 2, pollMs: 500 })
