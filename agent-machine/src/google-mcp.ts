// google-mcp.ts — G1 "cái Tay": Google Workspace READONLY (Gmail/Calendar/Drive/YouTube) gói thành in-process MCP server.
// OAuth: refresh access_token từ GOOGLE_REFRESH_TOKEN + client_id/secret (.gcp-oauth.json) qua token_uri grant_type=refresh_token.
// Cache access_token theo expires_in; refresh khi hết hạn hoặc API trả 401 (retry 1 lần). TUYỆT ĐỐI KHÔNG log/echo token value.
// Read-only: chỉ GET (gmail.readonly/calendar.readonly/drive.readonly/youtube.readonly). Lỗi → trả ERROR string (không nổ).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

const T = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })

// ─────────────────────────── OAuth client (.gcp-oauth.json) ───────────────────────────
interface OAuthClient { client_id: string; client_secret: string; token_uri: string }
let cachedClient: OAuthClient | null = null

function loadClient(): OAuthClient | null {
  if (cachedClient) return cachedClient
  const p = process.env.GCP_OAUTH_FILE || path.join(os.homedir(), 'lucy', '.gcp-oauth.json')
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    const c = raw.installed || raw.web || raw
    if (!c?.client_id || !c?.client_secret) return null
    cachedClient = {
      client_id: String(c.client_id),
      client_secret: String(c.client_secret),
      token_uri: String(c.token_uri || 'https://oauth2.googleapis.com/token'),
    }
    return cachedClient
  } catch { return null }
}

/** Có đủ creds để dựng server google không (KHÔNG đọc value ra ngoài). */
export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_REFRESH_TOKEN && String(process.env.GOOGLE_REFRESH_TOKEN).trim() && loadClient())
}

// ─────────────────────────── access_token cache + refresh ───────────────────────────
let accessToken: string | null = process.env.GOOGLE_ACCESS_TOKEN?.trim() || null
let tokenExpiry = 0 // epoch ms; 0 = chưa biết hạn (token tĩnh từ env có thể đã hết hạn → refresh khi 401)

async function timed(url: string, init: RequestInit, ms = 12000): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { ...init, signal: ctrl.signal }) }
  finally { clearTimeout(t) }
}

// Refresh access_token từ refresh_token. Trả token mới hoặc null (lỗi). KHÔNG log token.
async function refreshAccessToken(): Promise<string | null> {
  const client = loadClient()
  const refresh = process.env.GOOGLE_REFRESH_TOKEN?.trim()
  if (!client || !refresh) return null
  const body = new URLSearchParams({
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: refresh,
    grant_type: 'refresh_token',
  })
  try {
    const r = await timed(client.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!r.ok) return null
    const d = (await r.json()) as { access_token?: string; expires_in?: number }
    if (!d.access_token) return null
    accessToken = d.access_token
    tokenExpiry = Date.now() + (d.expires_in ? d.expires_in * 1000 : 3600 * 1000) - 60_000 // -60s đệm
    return accessToken
  } catch { return null }
}

// Lấy access_token còn hạn (refresh nếu cần). force=true → refresh bất kể cache (dùng sau 401).
async function getToken(force = false): Promise<string | null> {
  if (!force && accessToken && Date.now() < tokenExpiry) return accessToken
  if (!force && accessToken && !tokenExpiry) return accessToken // token tĩnh từ env, chưa biết hạn → thử dùng
  return refreshAccessToken()
}

// GET 1 endpoint Google với Bearer; tự refresh + retry 1 lần khi 401. Trả parsed JSON hoặc {__error}.
async function gget(url: string): Promise<any> {
  let tok = await getToken()
  if (!tok) return { __error: 'không lấy được access_token (refresh thất bại)' }
  let r = await timed(url, { headers: { authorization: `Bearer ${tok}`, accept: 'application/json' } })
  if (r.status === 401) {
    tok = await getToken(true)
    if (!tok) return { __error: 'refresh access_token thất bại (401)' }
    r = await timed(url, { headers: { authorization: `Bearer ${tok}`, accept: 'application/json' } })
  }
  if (!r.ok) return { __error: `HTTP ${r.status}` }
  try { return await r.json() } catch { return { __error: 'parse JSON lỗi' } }
}

const enc = encodeURIComponent

// ─────────────────────────── tools (READONLY) ───────────────────────────
// (export cho live-smoke gọi trực tiếp — KHÔNG đổi hành vi)
export async function gmailSearch(query: string, max: number): Promise<string> {
  const n = Math.max(1, Math.min(Math.floor(max) || 5, 20))
  const list = await gget(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${enc(query)}&maxResults=${n}`)
  if (list.__error) return 'ERROR gmail_search: ' + list.__error
  const msgs: { id: string }[] = list.messages || []
  if (!msgs.length) return `(không có mail khớp "${query}")`
  const out: string[] = []
  for (const m of msgs.slice(0, n)) {
    const d = await gget(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)
    if (d.__error) { out.push(`• [${m.id}] (lỗi đọc meta: ${d.__error})`); continue }
    const hs: { name: string; value: string }[] = d.payload?.headers || []
    const from = hs.find((h) => h.name === 'From')?.value || '?'
    const subj = hs.find((h) => h.name === 'Subject')?.value || '(không tiêu đề)'
    out.push(`• [${m.id}] ${subj}\n  từ: ${from}\n  ${(d.snippet || '').slice(0, 160)}`)
  }
  return `Gmail "${query}" — ${out.length} mail:\n${out.join('\n')}`
}

async function gmailRead(id: string): Promise<string> {
  const d = await gget(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${enc(id)}?format=full`)
  if (d.__error) return 'ERROR gmail_read: ' + d.__error
  const hs: { name: string; value: string }[] = d.payload?.headers || []
  const h = (n: string) => hs.find((x) => x.name === n)?.value || ''
  // trích body text/plain (đệ quy parts) → decode base64url
  let body = ''
  const walk = (part: any): void => {
    if (!part || body) return
    if (part.mimeType === 'text/plain' && part.body?.data) {
      try { body = Buffer.from(part.body.data, 'base64').toString('utf8') } catch { /* skip */ }
    }
    for (const p of part.parts || []) walk(p)
  }
  walk(d.payload)
  if (!body && d.payload?.body?.data) { try { body = Buffer.from(d.payload.body.data, 'base64').toString('utf8') } catch { /* skip */ } }
  return [
    `Mail [${id}]:`,
    `tiêu đề: ${h('Subject') || '(không tiêu đề)'}`,
    `từ: ${h('From')}`,
    `ngày: ${h('Date')}`,
    `\n${(body || d.snippet || '(trống)').slice(0, 4000)}`,
  ].join('\n')
}

export async function calendarUpcoming(max: number): Promise<string> {
  const n = Math.max(1, Math.min(Math.floor(max) || 10, 20))
  const now = new Date().toISOString()
  const d = await gget(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${enc(now)}&singleEvents=true&orderBy=startTime&maxResults=${n}`)
  if (d.__error) return 'ERROR calendar_upcoming: ' + d.__error
  const items: any[] = d.items || []
  if (!items.length) return '(không có sự kiện sắp tới)'
  const lines = items.map((e) => {
    const start = e.start?.dateTime || e.start?.date || '?'
    return `• ${e.summary || '(không tên)'} — ${start}${e.location ? ` @ ${e.location}` : ''}`
  })
  return `Lịch sắp tới — ${lines.length} sự kiện:\n${lines.join('\n')}`
}

async function driveSearch(query: string): Promise<string> {
  const q = `name contains '${String(query).replace(/'/g, "\\'")}' and trashed = false`
  const fields = 'files(id,name,mimeType,modifiedTime)'
  const d = await gget(`https://www.googleapis.com/drive/v3/files?q=${enc(q)}&pageSize=15&fields=${enc(fields)}&orderBy=modifiedTime desc`)
  if (d.__error) return 'ERROR drive_search: ' + d.__error
  const files: any[] = d.files || []
  if (!files.length) return `(không có file Drive khớp "${query}")`
  const lines = files.map((f) => `• ${f.name}  [${(f.mimeType || '').replace('application/vnd.google-apps.', '')}]  ${(f.modifiedTime || '').slice(0, 10)}  (id ${f.id})`)
  return `Drive "${query}" — ${lines.length} file:\n${lines.join('\n')}`
}

export async function youtubeMyChannel(): Promise<string> {
  const d = await gget('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true')
  if (d.__error) return 'ERROR youtube_my_channel: ' + d.__error
  const ch = (d.items || [])[0]
  if (!ch) return '(không tìm thấy kênh YouTube cho tài khoản này)'
  const s = ch.statistics || {}
  return [
    `Kênh: ${ch.snippet?.title || '?'} (id ${ch.id})`,
    `• subscribers: ${s.subscriberCount ?? '?'}`,
    `• video: ${s.videoCount ?? '?'}`,
    `• lượt xem: ${s.viewCount ?? '?'}`,
  ].join('\n')
}

async function youtubeSearch(query: string): Promise<string> {
  const d = await gget(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&q=${enc(query)}`)
  if (d.__error) return 'ERROR youtube_search: ' + d.__error
  const items: any[] = d.items || []
  if (!items.length) return `(không có video khớp "${query}")`
  const lines = items.map((v) => `• ${v.snippet?.title || '?'} — ${v.snippet?.channelTitle || '?'} (${(v.snippet?.publishedAt || '').slice(0, 10)})`)
  return `YouTube "${query}" — ${lines.length} video:\n${lines.join('\n')}`
}

// ─────────────────────────── SDK in-process server ───────────────────────────
export function googleServer(): unknown {
  return createSdkMcpServer({
    name: 'google', version: '1.0.0',
    tools: [
      tool('gmail_search', 'Tìm email Gmail (READONLY). query dùng cú pháp Gmail (vd "newer_than:7d", "from:x"). Trả from/subject/snippet + id.',
        { query: z.string().describe('truy vấn Gmail'), max: z.number().optional().describe('số mail, mặc định 5, ≤20') },
        async (a) => T(await gmailSearch(String(a.query), a.max ? Number(a.max) : 5))),
      tool('gmail_read', 'Đọc 1 email theo id (lấy từ gmail_search). Trả tiêu đề/từ/ngày + nội dung text.',
        { id: z.string().describe('message id') },
        async (a) => T(await gmailRead(String(a.id)))),
      tool('calendar_upcoming', 'Sự kiện lịch Google sắp tới (READONLY) — tiêu đề + giờ bắt đầu.',
        { max: z.number().optional().describe('số sự kiện, mặc định 10, ≤20') },
        async (a) => T(await calendarUpcoming(a.max ? Number(a.max) : 10))),
      tool('drive_search', 'Tìm file Google Drive theo tên (READONLY) — tên + loại + ngày sửa.',
        { query: z.string().describe('phần tên file cần tìm') },
        async (a) => T(await driveSearch(String(a.query)))),
      tool('youtube_my_channel', 'Thông tin kênh YouTube của tài khoản (READONLY) — tên + subscribers + số video + views.',
        {},
        async () => T(await youtubeMyChannel())),
      tool('youtube_search', 'Tìm video YouTube (READONLY) — tiêu đề + kênh + ngày đăng.',
        { query: z.string().describe('truy vấn tìm video') },
        async (a) => T(await youtubeSearch(String(a.query)))),
    ],
  })
}
