// smoke-distill — verify A2 + inbox-expiry bằng CHẠY THẬT (vault tạm, claude -p haiku thật).
//   npx tsx src/smoke-distill.ts            # cần claude CLI trên máy
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dream } from './dream'
import { distillCard } from './distill'
import { writeSignal } from './signal'
import type { Card } from './types'

const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-smoke-distill-'))
for (const d of ['Brain/inbox', 'Brain/preferences', 'Brain/log']) fs.mkdirSync(path.join(vault, d), { recursive: true })
console.log(`vault tạm: ${vault}\n`)

// ── 1) INBOX EXPIRY: signal 20 ngày tuổi (cửa sổ 14d) → dream phải dọn sang processed ──
const oldTs = new Date(Date.now() - 20 * 86400e3)
const oldFile = path.join(vault, 'Brain', 'inbox', 'sig-old-test.md')
fs.writeFileSync(oldFile, [
  '---', 'kind: brain-signal', 'id: sig-old-test', `created_at: ${oldTs.toISOString()}`,
  'topic: demo/lac-loai', 'signal: negative', 'agent: engine', 'principle: signal mồ côi quá hạn', '---', '',
].join('\n'))
const s1 = dream(vault)
const moved = fs.existsSync(path.join(vault, 'Brain', 'inbox', 'processed', 'sig-old-test.md'))
console.log(`[expiry] dream: expiredSignals=${s1.expiredSignals} changed=${s1.changed} → moved-to-processed=${moved}`)
if (s1.expiredSignals !== 1 || !moved) { console.error('❌ expiry FAIL'); process.exit(1) }
const s1b = dream(vault)
console.log(`[expiry] dream lần 2 (idempotent): changed=${s1b.changed} expiredSignals=${s1b.expiredSignals}`)
if (s1b.changed) { console.error('❌ idempotency FAIL'); process.exit(1) }

// ── 2) DISTILL THẬT: card "bị trả lại vì hardcode + thiếu verify" → claude haiku rút signal ──
const card: Card = {
  id: 'card_smoke1', title: 'Thêm endpoint /metrics cho arena-server', projectId: 'arena-server',
  brief: 'Expose Prometheus metrics (request count, latency) trên port riêng.',
  pipelineId: 'p', stageIndex: 2, status: 'done', workspace: '', depth: 0, blockedBy: [],
  reviewNotes: [
    'Port 9090 đang hardcode trong src/metrics.ts — phải đọc từ env METRICS_PORT, default mới được hardcode.',
    'Báo "xong" nhưng chưa chạy thử curl /metrics — lần sau tự verify bằng lệnh thật trước khi báo.',
  ],
  reports: [
    { stage: 's1', persona: 'Max', text: 'Đã thêm src/metrics.ts dùng prom-client, expose /metrics trên port 9090. Đã đăng ký counter http_requests_total và histogram latency.', ts: Date.now() - 3600e3 },
    { stage: 's2', persona: 'Rin', text: 'REWORK: port 9090 hardcode (vi phạm convention env-first của repo, xem src/env.ts). Ngoài ra chưa có bằng chứng chạy thử.', ts: Date.now() - 1800e3 },
    { stage: 's1', persona: 'Max', text: 'Đã sửa: METRICS_PORT đọc từ env (default 9090) khai trong src/env.ts đúng convention. Chạy thử: curl localhost:9090/metrics trả 200 với 14 metric. Typecheck sạch.', ts: Date.now() - 600e3 },
  ],
  history: [
    { ts: Date.now() - 4000e3, stage: 's1', event: 'advance' },
    { ts: Date.now() - 1800e3, stage: 's1', event: 'rework', detail: 'port hardcode + thiếu verify' },
    { ts: Date.now() - 300e3, stage: 's2', event: 'advance' },
    { ts: Date.now() - 100e3, stage: 's2', event: 'done' },
  ],
  cost: { usd: 0.2, inTok: 1000, outTok: 500 }, createdAt: Date.now() - 5000e3, updatedAt: Date.now(),
}
console.log('\n[distill] gọi claude -p (haiku) thật…')
const sigs = await distillCard(vault, card)
console.log(`[distill] ${sigs.length} signal:`)
for (const s of sigs) console.log(`  - [${s.signal}] ${s.topic} :: ${s.principle}${s.scope ? ` (${s.scope})` : ''}`)
const files = fs.readdirSync(path.join(vault, 'Brain', 'inbox')).filter((f) => f.endsWith('.md'))
console.log(`[distill] file trong inbox: ${files.join(', ') || '(0)'}`)
if (!sigs.length || !files.length) { console.error('❌ distill FAIL (0 signal — xem output trên)'); process.exit(1) }

// ── 3) MẠCH KHÉP KÍN: thêm 1 signal cùng topic (card khác) → dream graduate cross-card ──
const first = sigs[0]
writeSignal(vault, { topic: first.topic, signal: first.signal, principle: first.principle, cardId: 'card_smoke2', agent: 'distill', raw: 'card khác cùng pattern' })
const s3 = dream(vault)
console.log(`\n[dream] graduate=${s3.graduated.join(',') || '(0)'} processed=${s3.processedSignals}`)
if (!s3.graduated.length) { console.error('❌ graduate FAIL'); process.exit(1) }
const prefFile = fs.readdirSync(path.join(vault, 'Brain', 'preferences')).find((f) => f.endsWith('.md'))!
console.log(`[dream] preference: ${prefFile}`)
console.log(fs.readFileSync(path.join(vault, 'Brain', 'preferences', prefFile), 'utf8').split('\n').slice(0, 12).join('\n'))

fs.rmSync(vault, { recursive: true, force: true })
console.log('\n✅ smoke-distill PASS (vault tạm đã dọn)')
