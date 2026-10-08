// cred-pool — B2 (Đợt B): nhiều API key cho 1 provider → hết key nhảy key kia (free-tier chạy lâu hơn).
// Crib Hermes credential_pool.py. Key cooldown trong-process (xoay vòng); provider-guard cross-process lo ở rate-guard.
// Nguồn key: env `<ENVKEY>`, `<ENVKEY>_2`, `<ENVKEY>_3`... HOẶC CSV trong `<ENVKEY>` (k1,k2,k3). KHÔNG log/echo key.
import { PROVIDERS, type ProviderId } from './llm-lane'

const MAX_KEYS = 8
const keyCooldown = new Map<string, number>() // `${provider}#${keyHashShort}` -> until epoch (in-process)

// Lấy mọi key của provider từ env (đa key + CSV). Đọc qua process.env (llm-lane.loadEnvFile đã nạp .env.llm).
export function keysFor(provider: ProviderId): string[] {
  const base = PROVIDERS[provider].envKey
  const raw: string[] = []
  const v1 = process.env[base]
  if (v1) raw.push(...v1.split(',')) // CSV trong 1 biến
  for (let i = 2; i <= MAX_KEYS; i++) { const v = process.env[`${base}_${i}`]; if (v) raw.push(...v.split(',')) }
  // unique + bỏ rỗng
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of raw) { const t = k.trim(); if (t && !seen.has(t)) { seen.add(t); out.push(t) } }
  return out
}

// id ngắn KHÔNG lộ key (để làm map cooldown + log an toàn).
function keyId(provider: ProviderId, key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) { h = (h * 31 + key.charCodeAt(i)) | 0 }
  return `${provider}#${(h >>> 0).toString(36)}`
}

/** Key còn dùng được (không trong cooldown). Trả [] nếu tất cả đang cooldown / không có key. */
export function availableKeys(provider: ProviderId, now = Date.now()): string[] {
  return keysFor(provider).filter((k) => {
    const until = keyCooldown.get(keyId(provider, k))
    return !until || until <= now
  })
}

/** Đánh dấu 1 key cooldown (nhận 429/401) → xoay sang key khác. */
export function markKeyCooldown(provider: ProviderId, key: string, ms: number, now = Date.now()): void {
  keyCooldown.set(keyId(provider, key), now + Math.max(0, ms))
}

/** Có ÍT NHẤT 1 key (kể cả đang cooldown)? — phân biệt "không cấu hình" vs "đang nghẽn". */
export function hasAnyKey(provider: ProviderId): boolean {
  return keysFor(provider).length > 0
}
