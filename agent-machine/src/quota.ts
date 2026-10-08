// quota — B3 (Đợt B): đọc header rate-limit/credits từ response provider → lưu file → biết free-tier còn gì.
// Crib Hermes rate_limit_tracker.py (x-ratelimit-*) + credits_tracker.py (x-*-credits-*).
// Smart-router (Đợt A) + Hub đọc để TRÁNH con sắp cạn + cảnh báo trước. An toàn: mọi lỗi nuốt im.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { ProviderId } from './llm-lane'

function stateDir(): string { return process.env.LUCY_STATE_DIR || path.join(os.homedir(), '.lucy') }
function quotaFile(): string { return path.join(stateDir(), 'quota.json') }

export type QuotaEntry = {
  remainingRequests?: number
  remainingTokens?: number
  resetAt?: number      // epoch ms (nếu suy được)
  creditsRemainingUsd?: number
  updatedAt: number
}
type QuotaState = Record<string, QuotaEntry>

function read(): QuotaState {
  try { return JSON.parse(fs.readFileSync(quotaFile(), 'utf8')) as QuotaState } catch { return {} }
}
function write(s: QuotaState): void {
  try {
    fs.mkdirSync(stateDir(), { recursive: true })
    const tmp = quotaFile() + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(s))
    fs.renameSync(tmp, quotaFile())
  } catch { /* không critical */ }
}

function num(v: string | null): number | undefined {
  if (v == null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

// reset header có thể là giây (delta) hoặc epoch — chuẩn hoá về epoch ms (best-effort).
function parseReset(v: string | null, now: number): number | undefined {
  if (v == null) return undefined
  const n = Number(v)
  if (!Number.isFinite(n)) return undefined
  if (n > 1e12) return n                 // đã là epoch ms
  if (n > 1e9) return n * 1000           // epoch giây
  return now + n * 1000                  // delta giây
}

/** Ghi quota từ header response (gọi sau call thành công). headers = fetch Response.headers. */
export function recordQuota(provider: ProviderId, headers: Headers, now = Date.now()): void {
  try {
    const h = (k: string) => headers.get(k)
    const remainingRequests = num(h('x-ratelimit-remaining-requests') || h('x-ratelimit-remaining'))
    const remainingTokens = num(h('x-ratelimit-remaining-tokens'))
    const resetAt = parseReset(h('x-ratelimit-reset-requests') || h('x-ratelimit-reset'), now)
    const creditsRemainingUsd = num(h('x-nous-credits-remaining-usd') || h('x-credits-remaining-usd'))
    // không có header nào → khỏi ghi (đỡ rác)
    if (remainingRequests === undefined && remainingTokens === undefined && creditsRemainingUsd === undefined) return
    const s = read()
    s[provider] = { remainingRequests, remainingTokens, resetAt, creditsRemainingUsd, updatedAt: now }
    write(s)
  } catch { /* nuốt */ }
}

/** Snapshot cho Hub/router (provider → quota gần nhất). */
export function quotaSnapshot(): QuotaState { return read() }

/** Provider sắp cạn? (remaining requests < ngưỡng) — router né, cảnh báo. */
export function isNearlyExhausted(provider: ProviderId, threshold = 5): boolean {
  const e = read()[provider]
  return !!e && e.remainingRequests !== undefined && e.remainingRequests <= threshold
}
