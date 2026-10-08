// rate-guard — B1 (Đợt B): chặn retry-amplification cross-process cho free model.
// Crib Hermes nous_rate_guard.py: 1 cú 429 → ghi state RA FILE; mọi tiến trình (coordinator/worker/distill)
// check TRƯỚC khi gọi provider → KHÔNG đâm thêm request vào provider đang bị limit (đỡ phí quota free-tier).
// An toàn: lỗi đọc/ghi nuốt im (rate-guard hỏng KHÔNG được chặn lane chạy). Atomic write (tmp+rename) chống race.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { ProviderId } from './llm-lane'

function stateDir(): string {
  return process.env.LUCY_STATE_DIR || path.join(os.homedir(), '.lucy')
}
function guardFile(): string {
  return path.join(stateDir(), 'rate-guard.json')
}

type GuardState = Record<string, { until: number; reason: string }>

function read(): GuardState {
  try { return JSON.parse(fs.readFileSync(guardFile(), 'utf8')) as GuardState } catch { return {} }
}

function write(s: GuardState): void {
  try {
    fs.mkdirSync(stateDir(), { recursive: true })
    const tmp = guardFile() + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(s))
    fs.renameSync(tmp, guardFile()) // atomic: 2 process không thấy file nửa vời
  } catch { /* ghi guard hỏng không critical */ }
}

/** ms còn lại provider bị guard (0 = không bị). Đọc file mỗi lần → thấy 429 của process khác ngay. */
export function guardedFor(provider: ProviderId, now = Date.now()): number {
  const s = read()
  const e = s[provider]
  if (!e || e.until <= now) return 0
  return e.until - now
}

/** Ghi provider bị rate-limit tới `now + retryAfterMs`. Gọi khi nhận 429. */
export function markGuarded(provider: ProviderId, retryAfterMs: number, reason = '429', now = Date.now()): void {
  const s = read()
  const until = now + Math.max(0, retryAfterMs)
  // chỉ kéo DÀI, không rút ngắn (nhiều 429 liên tiếp → giữ mốc xa nhất)
  if (!s[provider] || s[provider].until < until) s[provider] = { until, reason: reason.slice(0, 120) }
  // dọn entry hết hạn luôn (hygiene)
  for (const k of Object.keys(s)) if (s[k].until <= now) delete s[k]
  write(s)
}

/** Snapshot cho Hub/quan sát (provider → giây còn lại). */
export function guardSnapshot(now = Date.now()): { provider: string; secondsLeft: number; reason: string }[] {
  const s = read()
  return Object.entries(s)
    .filter(([, e]) => e.until > now)
    .map(([provider, e]) => ({ provider, secondsLeft: Math.round((e.until - now) / 1000), reason: e.reason }))
}
