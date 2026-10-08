// web-tools.ts — tool WEB cho lane model (research): web_fetch + web_search. No-key (DuckDuckGo). SSRF-guarded.
// Phase M: cho model rẻ "biết dùng web" như Hermes. Read-only network, chặn host nội bộ.
// X2 (Jina Reader): flag LUCY_JINA_READER → ưu tiên r.jina.ai (URL→markdown sạch) + s.jina.ai (search) cho chất lượng cao hơn;
//   lỗi/tắt → fallback DuckDuckGo/stripHtml cũ. Key Jina TÙY CHỌN (có → rate-limit cao hơn).
import { jinaKey } from './embed'

// chặn host nội bộ/loopback/link-local/private (SSRF guard)
const BLOCK = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|::1|\[::1\])/i
function safeUrl(u: string): URL | null {
  try {
    const x = new URL(u.trim())
    if (!/^https?:$/.test(x.protocol)) return null
    if (BLOCK.test(x.hostname)) return null
    return x
  } catch { return null }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
async function timedFetch(url: string | URL, ms = 20000, extraHeaders?: Record<string, string>): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, 'accept-language': 'vi,en;q=0.8', ...extraHeaders }, redirect: 'follow' }) }
  finally { clearTimeout(t) }
}

// X2 — flag LUCY_JINA_READER: '1'/'true'/'on' → dùng Jina Reader/Search. Mặc định TẮT (giữ no-key DuckDuckGo).
export function jinaReaderOn(): boolean {
  const f = (process.env.LUCY_JINA_READER || '').toLowerCase()
  return f === '1' || f === 'true' || f === 'on'
}

function jinaHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const key = jinaKey()
  if (key) h.authorization = `Bearer ${key}` // tùy chọn — không có key vẫn chạy (rate-limit thấp hơn)
  return h
}

// r.jina.ai/<URL> → markdown sạch (đã bỏ nav/quảng cáo, giữ nội dung). Lỗi/non-2xx → ném để caller fallback.
async function jinaRead(targetUrl: string, maxChars: number): Promise<string> {
  const r = await timedFetch('https://r.jina.ai/' + targetUrl, 25000, jinaHeaders({ 'x-return-format': 'markdown' }))
  if (!r.ok) throw new Error(`Jina Reader ${r.status}`)
  const text = (await r.text()).trim()
  if (!text) throw new Error('Jina Reader rỗng')
  return `[Jina Reader] ${targetUrl}\n\n${text.slice(0, maxChars)}${text.length > maxChars ? '\n…(cắt bớt)' : ''}`
}

// s.jina.ai/?q=<query> → markdown top kết quả (kèm trích nội dung). Lỗi/non-2xx → ném để caller fallback.
async function jinaSearch(query: string, maxChars: number): Promise<string> {
  const r = await timedFetch('https://s.jina.ai/?q=' + encodeURIComponent(query), 25000, jinaHeaders())
  if (!r.ok) throw new Error(`Jina Search ${r.status}`)
  const text = (await r.text()).trim()
  if (!text) throw new Error('Jina Search rỗng')
  return text.slice(0, maxChars) + (text.length > maxChars ? '\n…(cắt bớt)' : '')
}

/** Lấy nội dung 1 URL → text (strip HTML). Cap để khỏi phình context. */
export async function webFetch(url: string, maxChars = 8000): Promise<string> {
  const u = safeUrl(url)
  if (!u) return 'ERROR: URL không hợp lệ hoặc bị chặn (chỉ http/https, không host nội bộ).'
  // X2: Jina Reader (markdown sạch) trước, lỗi → rơi xuống fetch+stripHtml thường. URL đã qua SSRF guard ở trên.
  if (jinaReaderOn()) {
    try { return await jinaRead(u.href, maxChars) }
    catch (e) { console.warn('[web] Jina Reader lỗi → fallback fetch: ' + String((e as Error)?.message || e).slice(0, 120)) }
  }
  try {
    const r = await timedFetch(u)
    const ct = r.headers.get('content-type') || ''
    const body = await r.text()
    const text = /html|xml/i.test(ct) ? stripHtml(body) : body
    return `[HTTP ${r.status}] ${u.href}\n\n${text.slice(0, maxChars)}${text.length > maxChars ? '\n…(cắt bớt)' : ''}`
  } catch (e) { return 'ERROR web_fetch: ' + String((e as Error)?.message || e).slice(0, 200) }
}

function decodeDDG(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/)
  if (m) { try { return decodeURIComponent(m[1]) } catch { /* */ } }
  if (href.startsWith('//')) return 'https:' + href
  return href
}

/** Search web no-key qua DuckDuckGo lite (best-effort scrape). Trả top N {title,url}. */
export async function webSearch(query: string, n = 5): Promise<string> {
  const q = query.trim()
  if (!q) return 'ERROR: query rỗng'
  // X2: Jina Search (s.jina.ai) trước, lỗi → rơi xuống DuckDuckGo lite scrape.
  if (jinaReaderOn()) {
    try { return await jinaSearch(q, Math.max(2000, n * 1200)) }
    catch (e) { console.warn('[web] Jina Search lỗi → fallback DDG: ' + String((e as Error)?.message || e).slice(0, 120)) }
  }
  try {
    const r = await timedFetch('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q))
    const html = await r.text()
    const out: { title: string; url: string }[] = []
    const seen = new Set<string>()
    // anchor kết quả DDG (lite + html endpoint): rel="nofollow" ... href="...uddg=<encoded>"
    for (const m of html.matchAll(/<a\s+rel="nofollow"[^>]*href="([^"]*uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = decodeDDG(m[1].replace(/&amp;/g, '&')); const title = stripHtml(m[2])
      if (url && title && title.length > 2 && !seen.has(url)) { seen.add(url); out.push({ title, url }) }
      if (out.length >= n) break
    }
    if (!out.length) return '(không lấy được kết quả search — thử web_fetch trực tiếp 1 URL bạn biết)'
    return out.map((l, i) => `${i + 1}. ${l.title}\n   ${l.url}`).join('\n')
  } catch (e) { return 'ERROR web_search: ' + String((e as Error)?.message || e).slice(0, 200) }
}
