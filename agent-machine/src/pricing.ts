// pricing.ts — DASH-FIX S3: bảng giá token→USD (1 NGUỒN DUY NHẤT).
// Coordinator tính USD khi nhận POST /spend (python/hub chỉ gửi token) → tránh python↔TS lệch bảng giá.
// Quy ước: cache_read ~0.1× input, cache_creation(write) ~1.25× input (Anthropic).
// Giá hardcode = FALLBACK (số/1M token, USD). Tool fetch OpenRouter API cập nhật cho model lane (free/rẻ).

export type ModelPrice = { in: number; out: number; cacheRead: number; cacheWrite: number } // USD / 1M token

// FALLBACK hardcode — Anthropic (giá xác nhận qua claude-api skill 2026-06):
// fable-5 10/50 · opus-4.x 5/25 · sonnet-4.x 3/15 · haiku-4.5 1/5. cacheRead=0.1×in, cacheWrite=1.25×in.
const FALLBACK: Record<string, ModelPrice> = {
  'claude-fable-5': { in: 10, out: 50, cacheRead: 1.0, cacheWrite: 12.5 },
  'claude-opus': { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet': { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku': { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
}

// Giá fetch từ OpenRouter (keyed by slug đã lowercase, vd 'nvidia/nemotron-nano-9b-v2:free'). Rỗng tới khi refresh.
const FETCHED: Record<string, ModelPrice> = {}
let lastFetch = 0

/** Gom mọi biến thể tên Claude (short 'opus'/'sonnet' hoặc full id 'claude-opus-4-8') về key canonical của FALLBACK. */
function canon(model: string): string {
  const m = (model || '').toLowerCase()
  if (m.includes('fable') || m.includes('mythos')) return 'claude-fable-5'
  if (m.includes('opus')) return 'claude-opus'
  if (m.includes('sonnet')) return 'claude-sonnet'
  if (m.includes('haiku')) return 'claude-haiku'
  return m
}

/** Giá 1 model: ưu tiên slug fetch OpenRouter (lane), rồi canonical Claude hardcode. null = không biết giá → cost 0. */
export function priceFor(model: string): ModelPrice | null {
  const raw = (model || '').toLowerCase().trim()
  if (!raw) return null
  if (FETCHED[raw]) return FETCHED[raw]
  const c = canon(raw)
  if (FALLBACK[c]) return FALLBACK[c]
  if (FETCHED[c]) return FETCHED[c]
  return null
}

/** Tính USD cho 1 lần đốt token. cacheReadTok ~0.1×, cacheWriteTok ~1.25× (giá đã gồm hệ số trong ModelPrice). */
export function usdFor(
  model: string,
  t: { inTok?: number; outTok?: number; cacheReadTok?: number; cacheWriteTok?: number },
): number {
  const p = priceFor(model)
  if (!p) return 0
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0 }
  const M = 1_000_000
  const usd =
    (n(t.inTok) * p.in + n(t.outTok) * p.out + n(t.cacheReadTok) * p.cacheRead + n(t.cacheWriteTok) * p.cacheWrite) / M
  return Math.round(usd * 1e6) / 1e6
}

/**
 * Fetch giá từ OpenRouter API → nạp FETCHED (cho model lane rẻ/free). Fallback (lỗi/offline) = giữ hardcode.
 * Best-effort, KHÔNG throw ra ngoài. Tự cache ≥1h (đừng spam). Ép cập nhật: force=true.
 */
export async function refreshOpenRouterPrices(force = false): Promise<{ ok: boolean; count: number; error?: string }> {
  const now = Date.now()
  if (!force && now - lastFetch < 3600_000) return { ok: true, count: Object.keys(FETCHED).length }
  lastFetch = now
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 15_000)
    const r = await fetch('https://openrouter.ai/api/v1/models', { signal: ac.signal }).finally(() => clearTimeout(timer))
    if (!r.ok) return { ok: false, count: 0, error: `HTTP ${r.status}` }
    const j = (await r.json()) as { data?: Array<{ id?: string; pricing?: Record<string, string> }> }
    let count = 0
    for (const m of j.data || []) {
      const id = String(m.id || '').toLowerCase().trim()
      const pr = m.pricing || {}
      // OpenRouter trả giá /token (USD). Quy về /1M.
      const inTok = Number(pr.prompt), outTok = Number(pr.completion)
      if (!id || !Number.isFinite(inTok) || !Number.isFinite(outTok)) continue
      const cacheRead = Number(pr.input_cache_read)
      const cacheWrite = Number(pr.input_cache_write)
      FETCHED[id] = {
        in: inTok * 1e6,
        out: outTok * 1e6,
        cacheRead: Number.isFinite(cacheRead) ? cacheRead * 1e6 : inTok * 1e6 * 0.1,
        cacheWrite: Number.isFinite(cacheWrite) ? cacheWrite * 1e6 : inTok * 1e6 * 1.25,
      }
      count++
    }
    return { ok: true, count }
  } catch (e) {
    return { ok: false, count: 0, error: String(e instanceof Error ? e.message : e) }
  }
}
