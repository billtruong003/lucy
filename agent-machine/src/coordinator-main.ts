// Coordinator entry — CHẠY TRÊN VPS (nhẹ, always-on). KHÔNG chạy claude -p.
// Worker (máy local) quay ra nối vào đây. Env cấu hình; pm2 giữ sống.
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import { loadConfig } from './config'
import { startCoordinator } from './coordinator'
import { openRecallFromEnv } from './recall'
import { TokenGuard } from './token-guard'
import { refreshOpenRouterPrices } from './pricing'
import fs from 'node:fs'

const PORT = Number(process.env.AM_PORT || 8780)
const TOKEN = process.env.AM_TOKEN || ''
const DATA = process.env.AM_DATA || path.join(process.cwd(), '.data')
const CONFIG = process.env.AM_CONFIG || path.join(process.cwd(), 'config')
const VAULT = process.env.LUCY_VAULT && fs.existsSync(process.env.LUCY_VAULT) ? process.env.LUCY_VAULT : undefined

const store = new Store(DATA)
const loaded = loadConfig(store, CONFIG)
store.loadCustomPipelines() // flow tự tạo (override/bổ sung config) — nạp SAU config

// coordinator KHÔNG chạy claude -> runner chỉ là placeholder (worker remote mới chạy thật)
const engine = new Engine(store, new MockRunner({}), new Budget({
  windowMs: Number(process.env.AM_WINDOW_MS || 5 * 3600e3),
  capUsd: Number(process.env.AM_CAP_USD || 20),
  softUsd: Number(process.env.AM_SOFT_USD || 14),
  weeklyMs: 7 * 24 * 3600e3,
  weeklyCapUsd: Number(process.env.AM_WEEKLY_CAP_USD || 120),
}), {
  maxLanes: Number(process.env.AM_MAX_LANES || 3),
  perCardMaxUsd: Number(process.env.AM_PER_CARD_USD || 2), // $5 cũ quá cao → 1 card đốt nhiều mới dừng. Env đè được.
  maxStageVisits: Number(process.env.AM_MAX_STAGE_VISITS || 3), // rework tối đa ~2 vòng rồi hỏi người (chống lặp đốt token)
  leaseMs: Number(process.env.AM_LEASE_MS || 20 * 60e3),
})

// TokenGuard: giới hạn token/ngày (soft → autopilot hạ executor, hard → dừng tạo card)
const tokenGuard = new TokenGuard(DATA)
engine.tokenGuard = tokenGuard
// DASH-FIX S1: used() DẪN XUẤT = Σ ledger hôm nay (1 nguồn, hết double-count) thay vì counter riêng.
tokenGuard.ledgerSum = () => engine.ledgerUsedToday()
// DASH-FIX S3: prefetch giá OpenRouter (lane) — best-effort, lỗi/offline giữ hardcode. Không chặn boot.
refreshOpenRouterPrices().catch(() => {})
const tgInit = tokenGuard.check()

if (!TOKEN) console.warn('⚠ AM_TOKEN trống — endpoint /worker KHÔNG có auth. Đặt AM_TOKEN cho production.')
const recovered = engine.recover() // crash recovery: card 'working' mồ côi -> queued lại
// TRÍ NHỚ (M1): mở recall trên lucy-vault + warm index. Không set LUCY_VAULT → brain routes trả configured:false.
const recall = openRecallFromEnv()
if (recall) { const s = recall.reindex(); console.log(`🧠 recall index: ${s.total} note (+${s.indexed}/~${s.updated}/-${s.deleted})`) }
const co = startCoordinator(engine, store, PORT, { token: TOKEN || undefined, host: process.env.AM_HOST || '127.0.0.1', autoTickMs: Number(process.env.AM_TICK_MS || 800), recall, vaultDir: VAULT, configDir: CONFIG })
console.log(`🧠 Lucy Agent-Machine coordinator: http://127.0.0.1:${PORT}  (personas ${loaded.personas}, pipelines ${loaded.pipelines}, data ${DATA}${recovered ? `, recovered ${recovered}` : ''}${VAULT ? ', vault ON' : ''})`)
process.on('SIGINT', () => { co.stop(); process.exit(0) })
process.on('SIGTERM', () => { co.stop(); process.exit(0) })
