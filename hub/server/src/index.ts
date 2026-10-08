/**
 * Lucy Hub — Node/TS backend (Express). Web command center, standalone (KHÔNG Hermes).
 * Login + job nền + poll. Engine = `claude -p` (child_process). Serve React build (../../web/dist).
 *
 * Dev:  npm install ; (đặt env) ; npm run dev      (web: cd ../web && npm run dev, proxy /api)
 * Prod: cd ../web && npm run build ; rồi  npm start
 */
import 'dotenv/config'   // auto-load .env (cùng thư mục chạy) → pm2 khỏi cần set env tay
import express, { type Request } from 'express'
import cookieParser from 'cookie-parser'
import { spawn } from 'node:child_process'
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'  // Đường B: chat stream in-process (thay spawn cho streamClaude)
// CỤM B (Prompt Architect): gọi TRỰC TIẾP bộ não lõi cụm A (agent-machine, chạy in-process qua tsx).
// ADDITIVE + FLAG-GATED (LUCY_PROMPT_ARCHITECT). Import tĩnh OK vì hub server chạy bằng tsx (ESM/CJS interop).
import {
  runPromptArchitect, escalatePromptArchitect, recordUserEdit,
  promptArchitectFlagOn, sanitizeChatHistory,
} from '../../../agent-machine/src/prompt-architect'
import { getPromptArchitectStore } from '../../../agent-machine/src/prompt-architect-store'
import { z } from 'zod'  // K2: consult_expert schema
import { randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { generateSecret, generateSync, verifySync, generateURI } from 'otplib'
import * as qrcodeNs from 'qrcode'
const QRCode: any = (qrcodeNs as any).default || qrcodeNs
const totpOk = (code: string, secret: string) => { try { return verifySync({ token: code, secret }).valid } catch { return false } }

const home = (p: string) => p.replace(/^~/, os.homedir())

const PASSWORD = process.env.LUCY_HUB_PASSWORD || ''
const PORT = Number(process.env.LUCY_HUB_PORT || 8800)
const HOST = process.env.LUCY_HUB_HOST || '0.0.0.0'   // nginx setup: đặt 127.0.0.1 (chỉ nginx proxy vào)
const WORKDIR = home(process.env.LUCY_WORKDIR || '~/lucy/workspace')
const CLAUDE = process.env.CLAUDE_BIN || 'claude'
const PERSONA = home(process.env.LUCY_PERSONA || '~/lucy/bridge/persona.md')
// TRÍ NHỚ: vault = não DUY NHẤT — mọi claude -p phải --add-dir vault (không thì Lucy mù vault,
// ghi nhầm auto-memory built-in của Claude Code → 2 não đánh nhau, bug 2026-06-11).
const VAULT = home(process.env.LUCY_VAULT || '~/lucy/lucy-vault')
const TIMEOUT = Number(process.env.LUCY_CLAUDE_TIMEOUT || 900) * 1000
const DIST = path.join(__dirname, '..', '..', 'web', 'dist')
const PROJECTS = home(process.env.LUCY_PROJECTS_ROOT || WORKDIR)   // gốc cho tab Projects (file tree)
// (Voice đã bỏ — VPS 2GB không kham MeloTTS. Chỉ chat.)
// Brain-viz telemetry: integrations (API/MCP…) khai báo ở file -> mỗi cái = 1 node. Thêm vào file là node hiện.
const INTEGRATIONS_FILE = home(process.env.LUCY_INTEGRATIONS_FILE || path.join(PROJECTS, 'integrations.json'))
const TZ_OFFSET = Number(process.env.LUCY_TZ_OFFSET || 7)   // VN = UTC+7 (cho schedule)
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''       // optional: schedule đẩy Telegram
const TG_CHAT = process.env.LUCY_PUSH_CHAT_ID || process.env.LUCY_ALLOWED_USER_ID || ''
// Aki (radiant-bot Discord) control API — Lucy đẩy báo cáo / tạo kênh
const RADIANT_API = (process.env.RADIANT_BOT_API_URL || '').replace(/\/$/, '')
const AGENT_SECRET = process.env.RADIANT_BOT_AGENT_SECRET || ''
// Agent-Machine coordinator — hub proxy (browser gọi hub đã authed, token giữ server-side)
const AM_URL = (process.env.AM_COORD_URL || '').replace(/\/$/, '')
const AM_TOKEN = process.env.AM_TOKEN || ''
let lastAkiAt = 0   // brain-viz: node Aki sáng khi vừa đẩy
// STATE dir bền: 2FA secret, schedules, log, lịch sử chat
const STATE = home(process.env.LUCY_STATE || path.join(os.homedir(), '.lucy-hub'))
fs.mkdirSync(STATE, { recursive: true })
fs.mkdirSync(WORKDIR, { recursive: true })
const SECRET_FILE = path.join(STATE, 'twofa.json')
const SCHED_FILE = path.join(STATE, 'schedules.json')
const LOG_FILE = path.join(STATE, 'log.jsonl')
const CHAT_FILE = path.join(STATE, 'chat.json')

const readJSON = <T>(f: string, dflt: T): T => { try { return JSON.parse(fs.readFileSync(f, 'utf-8')) } catch { return dflt } }
const writeJSON = (f: string, v: unknown) => { try { fs.writeFileSync(f, JSON.stringify(v, null, 2)) } catch { /* */ } }

// ---- LOG (ring buffer + file jsonl) ----
type LogEv = { t: number; level: 'info' | 'warn' | 'error'; type: string; msg: string }
const logBuf: LogEv[] = []
function logEvent(level: LogEv['level'], type: string, msg: string) {
  const ev: LogEv = { t: Date.now(), level, type, msg: String(msg).slice(0, 500) }
  logBuf.push(ev); if (logBuf.length > 800) logBuf.shift()
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(ev) + '\n') } catch { /* */ }
}

function safePath(p: string): string | null {
  const base = path.resolve(PROJECTS)
  const r = path.resolve(base, p || '.')
  return r === base || r.startsWith(base + path.sep) ? r : null   // chặn path traversal ra ngoài root
}

const SESSION_TTL_MS = 7 * 86400 * 1000
const tokens = new Map<string, number>()   // token → hết hạn (ms)
type Job = { status: 'running' | 'done'; result: string | null; model: string; t0: number; session_id: string | null; prompt: string }
const jobs = new Map<string, Job>()

// Phase J — CHAT ĐA-PHIÊN: nhiều hội thoại lưu riêng (chats/<id>.json), `chat` = hội thoại HIỆN TẠI.
// Backward-compat: tự migrate chat.json cũ thành hội thoại đầu. `chat.messages`/`chat.sessionId`/saveChat() giữ nguyên API.
type ChatMsg = { role: 'me' | 'lucy'; text: string; t: number }
type Conversation = { id: string; title: string; sessionId: string | null; messages: ChatMsg[]; createdAt: number; updatedAt: number }
const CHATS_DIR = path.join(STATE, 'chats'); fs.mkdirSync(CHATS_DIR, { recursive: true })
const CUR_FILE = path.join(STATE, 'chats-current.json')
const convFile = (id: string) => path.join(CHATS_DIR, id.replace(/[^A-Za-z0-9_-]/g, '') + '.json')
const newConvId = () => randomBytes(6).toString('base64url')
const deriveTitle = (msgs: ChatMsg[]): string => {
  const first = msgs.find((m) => m.role === 'me')
  return first ? first.text.replace(/\s+/g, ' ').trim().slice(0, 48) : 'Hội thoại mới'
}
function listConversations(): { id: string; title: string; updatedAt: number; count: number }[] {
  try {
    return fs.readdirSync(CHATS_DIR).filter((f) => f.endsWith('.json'))
      .map((f) => readJSON<Conversation | null>(path.join(CHATS_DIR, f), null)).filter((c): c is Conversation => !!c?.id)
      .map((c) => ({ id: c.id, title: c.title || '(chưa đặt tên)', updatedAt: c.updatedAt || 0, count: c.messages?.length || 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch { return [] }
}
function loadConv(id: string): Conversation | null { return readJSON<Conversation | null>(convFile(id), null) }
function freshConv(): Conversation { return { id: newConvId(), title: 'Hội thoại mới', sessionId: null, messages: [], createdAt: Date.now(), updatedAt: Date.now() } }
let chat: Conversation = (() => {
  // migrate chat.json cũ → hội thoại đầu (1 lần)
  if (!listConversations().length) {
    const legacy = readJSON<{ sessionId: string | null; messages: ChatMsg[] } | null>(CHAT_FILE, null)
    if (legacy?.messages?.length) {
      const c: Conversation = { id: newConvId(), title: deriveTitle(legacy.messages), sessionId: legacy.sessionId, messages: legacy.messages, createdAt: Date.now(), updatedAt: Date.now() }
      writeJSON(convFile(c.id), c)
    }
  }
  const curId = readJSON<{ id?: string }>(CUR_FILE, {}).id
  if (curId) { const c = loadConv(curId); if (c) return c }
  const list = listConversations()
  if (list.length) { const c = loadConv(list[0].id); if (c) return c }
  const c = freshConv(); writeJSON(convFile(c.id), c); return c
})()
const setCurrent = (c: Conversation) => { chat = c; writeJSON(CUR_FILE, { id: c.id }) }
const saveChat = () => {
  if (chat.messages.length > 400) chat.messages = chat.messages.slice(-400)
  chat.updatedAt = Date.now()
  if ((!chat.title || chat.title === 'Hội thoại mới') && chat.messages.length) chat.title = deriveTitle(chat.messages)
  writeJSON(convFile(chat.id), chat)
}

function runClaude(prompt: string, sessionId: string | null, model: string): Promise<{ sid: string | null; text: string }> {
  const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', 'bypassPermissions', '--model', model]
  if (fs.existsSync(PERSONA)) args.push('--append-system-prompt-file', PERSONA)
  if (fs.existsSync(VAULT)) args.push('--add-dir', VAULT) // não vault luôn trong tầm mắt
  if (sessionId) args.push('--resume', sessionId)
  return new Promise((resolve) => {
    // stdio stdin='ignore' → claude khỏi chờ stdin 3s. CLAUDE phải là exe thật (win: ...\bin\claude.exe).
    const child = spawn(CLAUDE, args, {
      cwd: WORKDIR, env: { ...process.env, IS_SANDBOX: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = '', errb = ''
    const timer = setTimeout(() => child.kill(), TIMEOUT)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (errb += d))
    child.on('error', (e) => { clearTimeout(timer); resolve({ sid: null, text: `❌ spawn lỗi: ${String(e).slice(0, 400)}` }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 && !out) return resolve({ sid: null, text: `❌ Claude lỗi (${code}): ${(errb || '').slice(0, 600)}` })
      try {
        const d = JSON.parse(out)
        resolve({ sid: d.session_id || null, text: d.result || '(rỗng)' })
      } catch {
        resolve({ sid: null, text: (out || '(parse err)').slice(0, 3500) })
      }
    })
  })
}

// Phase D (D1+D3): claude -p stream-json → gọi onEvent khi có chữ/thinking/tool. Trả {sid, text, thinking}.
type StreamEvt = { type: 'delta' | 'thinking' | 'tool_use' | 'tool_result' | 'usage'; text?: string; name?: string; input?: string; id?: string; inTok?: number; cacheTok?: number; outTok?: number }
// gọn nội dung tool_result (string | mảng block) thành text ngắn để hiện UI
function toolResultText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('\n')
  return ''
}
// Đường B (Claude Agent SDK): query() in-process thay spawn. Cùng shape message (stream_event/assistant/user/result)
// → giữ y logic emit event. Dùng auth subscription như CLI. abort sau TIMEOUT.
async function streamClaude(prompt: string, sessionId: string | null, model: string,
                            onEvent: (e: StreamEvt) => void): Promise<{ sid: string | null; text: string; thinking: string }> {
  let answer = '', thinking = '', sid: string | null = null, finalResult: string | null = null
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT)
  const appendSys = fs.existsSync(PERSONA) ? fs.readFileSync(PERSONA, 'utf8') : undefined
  const dirs = fs.existsSync(VAULT) ? [VAULT] : undefined
  try {
    const q = query({
      prompt,
      options: {
        model, permissionMode: 'bypassPermissions', cwd: WORKDIR, includePartialMessages: true,
        ...(appendSys ? { appendSystemPrompt: appendSys } : {}),
        ...(dirs ? { additionalDirectories: dirs } : {}),
        ...(sessionId ? { resume: sessionId } : {}),
        env: { ...process.env, IS_SANDBOX: '1' },
        abortController: ac,
        mcpServers: { 'lucy-experts': expertMcpServer },  // K2 consult_expert inline (#3 minh bạch)
      },
    } as any)
    for await (const m of q as any) {
      if (m.type === 'stream_event' && m.event?.type === 'content_block_delta') {
        const dl = m.event.delta || {}
        if (dl.type === 'text_delta' && dl.text) { answer += dl.text; onEvent({ type: 'delta', text: dl.text }) }
        else if (dl.type === 'thinking_delta' && dl.thinking) { thinking += dl.thinking; onEvent({ type: 'thinking', text: dl.thinking }) }
      } else if (m.type === 'assistant') {
        for (const b of m.message?.content || []) {
          if (b?.type === 'tool_use') onEvent({ type: 'tool_use', name: b.name, input: JSON.stringify(b.input ?? {}).slice(0, 600), id: b.id })
        }
      } else if (m.type === 'user') {
        for (const b of m.message?.content || []) {
          if (b?.type === 'tool_result') onEvent({ type: 'tool_result', id: b.tool_use_id, text: toolResultText(b.content).slice(0, 800) })
        }
      } else if (m.type === 'result') {
        sid = m.session_id || sid; finalResult = m.result ?? null
        // E3: đo prompt-cache + context dùng — cho Hub HIỆN badge "cache X% · ctx Ytok"
        const u = m.usage || {}
        const inTok = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        onEvent({ type: 'usage', inTok, cacheTok: u.cache_read_input_tokens ?? 0, outTok: u.output_tokens ?? 0 })
        // DASH-FIX S2: tách input "tươi" + cache read/write riêng, kèm source='hub' + model thật (parity bridge claude-path).
        reportTok(u.input_tokens ?? 0, u.output_tokens ?? 0, { source: 'hub', model, cacheReadTok: u.cache_read_input_tokens ?? 0, cacheWriteTok: u.cache_creation_input_tokens ?? 0 })
      }
      else if (m.type === 'system' && m.session_id && !sid) sid = m.session_id
    }
  } catch (e) {
    clearTimeout(timer)
    return { sid, text: answer || `❌ SDK lỗi: ${String((e as any)?.message || e).slice(0, 300)}`, thinking }
  }
  clearTimeout(timer)
  return { sid, text: finalResult ?? answer ?? '(rỗng)', thinking }
}

const app = express()
// Chặn path-traversal probe (%c0%af...): decodeURIComponent throw URIError trong serve-static → sập process.
// Bắt sớm URL không decode được → 400, khỏi rơi vào static handler.
app.use((req, res, next) => {
  try { decodeURIComponent(req.path) } catch { return res.status(400).send('bad request') }
  next()
})
app.set('trust proxy', 'loopback')   // sau nginx: req.ip = IP thật, req.secure theo X-Forwarded-Proto
app.use(express.json())
app.use(cookieParser())
const authed = (req: Request) => {
  const tok = req.cookies?.lucy_token
  const exp = tok ? tokens.get(tok) : undefined
  if (!exp) return false
  if (exp < Date.now()) { tokens.delete(tok); return false }
  return true
}
function issueToken(req: Request, res: any) {
  const tok = randomBytes(24).toString('base64url')
  tokens.set(tok, Date.now() + SESSION_TTL_MS)
  res.cookie('lucy_token', tok, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_TTL_MS })
}
const sha = (s: string) => createHash('sha256').update(s).digest()
const passwordOk = (given: unknown) => !!PASSWORD && typeof given === 'string' && timingSafeEqual(sha(given), sha(PASSWORD))

// Chặn dò mật khẩu: tối đa LOGIN_MAX_FAILS lần sai mỗi IP trong LOGIN_WINDOW_MS.
const LOGIN_MAX_FAILS = 5, LOGIN_WINDOW_MS = 15 * 60 * 1000
const loginFails = new Map<string, { n: number; until: number }>()
const loginBlocked = (ip: string) => { const f = loginFails.get(ip); return !!f && f.until > Date.now() && f.n >= LOGIN_MAX_FAILS }
const loginFailed = (ip: string) => {
  const f = loginFails.get(ip)
  loginFails.set(ip, f && f.until > Date.now() ? { n: f.n + 1, until: f.until } : { n: 1, until: Date.now() + LOGIN_WINDOW_MS })
}

// ---- 2FA (TOTP, otplib v13) ----
let twofa = readJSON<{ secret?: string; enabled?: boolean }>(SECRET_FILE, {})
let pendingSecret: string | null = null   // secret chờ xác nhận khi setup
const twofaOn = () => !!(twofa.enabled && twofa.secret)

app.post('/login', (req, res) => {
  const ip = req.ip || 'unknown'
  if (loginBlocked(ip)) { logEvent('warn', 'auth', `login bị chặn tạm (${ip})`); return res.status(429).json({ ok: false, error: 'too_many_attempts' }) }
  if (!passwordOk(req.body?.password)) { loginFailed(ip); logEvent('warn', 'auth', 'login sai mật khẩu'); return res.status(401).json({ ok: false }) }
  if (twofaOn()) {
    const code = String(req.body?.code || '').trim()
    if (!code) return res.status(401).json({ ok: false, need_code: true })
    if (!totpOk(code, twofa.secret!)) { loginFailed(ip); logEvent('warn', 'auth', 'login sai mã 2FA'); return res.status(401).json({ ok: false, need_code: true, bad_code: true }) }
  }
  loginFails.delete(ip)
  issueToken(req, res); logEvent('info', 'auth', 'login thành công')
  res.json({ ok: true, twofa: twofaOn() })
})

app.get('/api/me', (req, res) => res.json({ authed: authed(req), twofa: twofaOn() }))

// 2FA quản lý (cần đã đăng nhập)
app.get('/api/2fa/status', (req, res) => { if (!authed(req)) return res.status(401).json({ error: 'unauth' }); res.json({ enabled: twofaOn() }) })
app.post('/api/2fa/setup', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  pendingSecret = generateSecret()
  const uri = generateURI({ issuer: 'Lucy Hub', label: 'chủ nhân', secret: pendingSecret })
  const qr = await QRCode.toDataURL(uri, { margin: 1, color: { dark: '#0a1322', light: '#bff8ff' } })
  res.json({ secret: pendingSecret, qr })
})
app.post('/api/2fa/enable', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const code = String(req.body?.code || '').trim()
  if (!pendingSecret || !totpOk(code, pendingSecret)) return res.status(400).json({ error: 'mã sai' })
  twofa = { secret: pendingSecret, enabled: true }; writeJSON(SECRET_FILE, twofa); pendingSecret = null
  logEvent('info', 'auth', '2FA đã bật'); res.json({ ok: true })
})
app.post('/api/2fa/disable', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const code = String(req.body?.code || '').trim()
  if (!twofaOn() || !totpOk(code, twofa.secret!)) return res.status(400).json({ error: 'mã sai' })
  twofa = {}; writeJSON(SECRET_FILE, twofa); logEvent('warn', 'auth', '2FA đã tắt'); res.json({ ok: true })
})

app.get('/api/logs', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  res.json({ logs: logBuf.slice(-200).reverse() })
})

app.post('/api/send', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const prompt = (req.body?.prompt || '').trim()
  if (!prompt) return res.status(400).json({ error: 'empty' })
  const model = req.body?.opus ? 'opus' : 'sonnet'
  // scope = chuỗi key (vd 'proj:<id>') → Lucy DỰ ÁN: phiên ĐỘC LẬP, KHÔNG --resume chat tổng,
  // KHÔNG ghi vào history chat tổng (hết lẫn ngữ cảnh + hết làm bẩn chat tổng). Lucy dự án tự nhồi
  // transcript mỗi lượt nên không cần --resume; lịch sử dự án lưu riêng ở kênh __lucy (client amLogLucy).
  const scope = typeof req.body?.scope === 'string' && req.body.scope.trim() ? req.body.scope.trim() : null
  const resumeSid = scope ? null : chat.sessionId
  const id = randomBytes(8).toString('base64url')
  if (!scope) { chat.messages.push({ role: 'me', text: prompt, t: Date.now() }); saveChat() }   // chỉ chat tổng mới lưu
  jobs.set(id, { status: 'running', result: null, model, t0: Date.now(), session_id: resumeSid, prompt: prompt.slice(0, 120) })
  logEvent('info', 'job', `▶ ${model}${scope ? ' · ' + scope : ''}: ${prompt.slice(0, 80)}`)
  runClaude(prompt, resumeSid, model).then(({ sid, text }) => {
    const j = jobs.get(id)
    if (j) { j.result = text; j.session_id = sid || j.session_id; j.status = 'done' }
    if (!scope) {   // chat tổng: cập nhật session + lưu trả lời. Lucy dự án: KHÔNG đụng chat tổng.
      chat.sessionId = sid || chat.sessionId
      chat.messages.push({ role: 'lucy', text, t: Date.now() }); saveChat()
    }
    logEvent('info', 'job', `✓ ${model} xong (${Math.floor((Date.now() - (j?.t0 || Date.now())) / 1000)}s)`)
  })
  res.json({ job_id: id })
})

app.get('/api/chat', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  res.json({ messages: chat.messages.slice(-200), id: chat.id, title: chat.title })
})
app.post('/api/chat/new', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const c = freshConv(); writeJSON(convFile(c.id), c); setCurrent(c); logEvent('info', 'chat', 'hội thoại mới')
  res.json({ ok: true, id: c.id })
})
// Phase J: quản nhiều hội thoại
app.get('/api/chats', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  res.json({ chats: listConversations(), currentId: chat.id })
})
app.post('/api/chats/switch', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const c = loadConv(String(req.body?.id || '')); if (!c) return res.status(404).json({ error: 'nochat' })
  setCurrent(c); res.json({ ok: true, id: c.id, messages: c.messages.slice(-200), title: c.title })
})
app.post('/api/chats/rename', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const id = String(req.body?.id || ''); const title = String(req.body?.title || '').trim().slice(0, 80)
  const c = loadConv(id); if (!c || !title) return res.status(400).json({ error: 'bad' })
  c.title = title; c.updatedAt = Date.now(); writeJSON(convFile(c.id), c)
  if (chat.id === c.id) chat.title = title
  res.json({ ok: true })
})
app.post('/api/chats/delete', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const id = String(req.body?.id || '')
  try { fs.unlinkSync(convFile(id)) } catch { /* đã mất */ }
  if (chat.id === id) { // xoá hội thoại đang mở → chuyển sang mới nhất / tạo mới
    const list = listConversations()
    const next = list.length ? loadConv(list[0].id) : null
    setCurrent(next || (() => { const c = freshConv(); writeJSON(convFile(c.id), c); return c })())
  }
  res.json({ ok: true, currentId: chat.id })
})

// ---- Aki (Discord) qua radiant-bot control API (HMAC) ----
const akiOn = () => !!(RADIANT_API && AGENT_SECRET)
async function akiCall(pathName: string, payload: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const body = JSON.stringify(payload)
  const sig = 'sha256=' + createHmac('sha256', AGENT_SECRET).update(body).digest('hex')
  const r = await fetch(RADIANT_API + pathName, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lucy-signature': sig }, body })
  let data: any = null; try { data = await r.json() } catch { /* */ }
  return { ok: r.ok, status: r.status, data }
}

app.get('/api/aki/status', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  res.json({ configured: akiOn() })
})
app.post('/api/aki/report', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!akiOn()) return res.status(400).json({ error: 'Aki chưa cấu hình (RADIANT_BOT_API_URL + RADIANT_BOT_AGENT_SECRET)' })
  const channel = String(req.body?.channel || '').trim()
  const text = String(req.body?.text || '').trim()
  if (!channel || !text) return res.status(400).json({ error: 'cần channel + text' })
  try {
    const r = await akiCall('/api/agent/post', { channel, text })
    lastAkiAt = Date.now()
    logEvent(r.ok ? 'info' : 'error', 'aki', r.ok ? `📣 đẩy báo cáo -> #${channel}` : `✗ Aki post lỗi: ${r.data?.error || r.status}`)
    res.status(r.ok ? 200 : 502).json(r.data || { error: 'aki ' + r.status })
  } catch (e) { logEvent('error', 'aki', 'Aki offline'); res.status(502).json({ error: 'Aki offline: ' + String(e).slice(0, 150) }) }
})
app.post('/api/aki/channel', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!akiOn()) return res.status(400).json({ error: 'Aki chưa cấu hình' })
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'cần name' })
  const payload = { name, type: req.body?.type === 'thread' ? 'thread' : 'text', parent: req.body?.parent, message: req.body?.message }
  try {
    const r = await akiCall('/api/agent/channel', payload)
    lastAkiAt = Date.now()
    logEvent(r.ok ? 'info' : 'error', 'aki', r.ok ? `➕ tạo ${payload.type} "${name}"` : `✗ Aki channel lỗi: ${r.data?.error || r.status}`)
    res.status(r.ok ? 200 : 502).json(r.data || { error: 'aki ' + r.status })
  } catch (e) { res.status(502).json({ error: 'Aki offline: ' + String(e).slice(0, 150) }) }
})

app.get('/api/poll/:id', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const j = jobs.get(req.params.id)
  if (!j) return res.status(404).json({ error: 'nojob' })
  res.json({
    status: j.status, result: j.result, model: j.model,
    elapsed: Math.floor((Date.now() - j.t0) / 1000), session_id: j.session_id,
  })
})

app.get('/api/jobs', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const list = [...jobs.entries()].slice(-30).reverse().map(([id, j]) => ({
    id, status: j.status, model: j.model, prompt: j.prompt, elapsed: Math.floor((Date.now() - j.t0) / 1000),
  }))
  res.json({ jobs: list })
})

// Brain-viz telemetry: graph state THẬT (node/link) từ jobs đang chạy + integrations + voice.
app.get('/api/telemetry', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const running = [...jobs.values()].filter((j) => j.status === 'running')
  const sonnetN = running.filter((j) => j.model === 'sonnet').length
  const opusN = running.filter((j) => j.model === 'opus').length
  let integrations: { id: string; label: string; group?: string }[] = []
  try { integrations = JSON.parse(fs.readFileSync(INTEGRATIONS_FILE, 'utf-8')) } catch { /* none */ }

  // PHÂN VÙNG lớn (zone) — core → zone → node
  const ZONES = [
    { id: 'z_agents', label: 'AGENTS' },
    { id: 'z_channels', label: 'CHANNELS' },
    { id: 'z_money', label: 'MONEY · DATA' },
    { id: 'z_dev', label: 'DEV' },
  ]
  // leaf hệ thống — LIVE (phản ánh state THẬT)
  const leaves: any[] = [
    { id: 'sonnet', label: 'Claude Sonnet', zone: 'z_agents', group: 'model', val: 13, active: sonnetN > 0, load: sonnetN, status: 'live' },
    { id: 'opus', label: 'Claude Opus', zone: 'z_agents', group: 'model', val: 13, active: opusN > 0, load: opusN, status: 'live' },
    { id: 'telegram', label: 'Telegram', zone: 'z_channels', group: 'channel', val: 10, active: false, status: 'live' },
    { id: 'aki', label: 'Aki · Discord', zone: 'z_channels', group: 'channel', val: 10, active: Date.now() - lastAkiAt < 8000, status: 'live' },
    { id: 'hub', label: 'Web Hub', zone: 'z_channels', group: 'channel', val: 11, active: true, status: 'live' },
  ]
  // mở rộng / IDEAS từ integrations.json (zone + status tuỳ chọn) — thêm dòng là có node
  for (const it of integrations as any[]) {
    leaves.push({ id: it.id, label: it.label, zone: it.zone || 'z_dev', group: it.group || 'api', val: it.val || 8, active: false, status: it.status || 'planned' })
  }
  // mỗi SCHEDULE/CRON = 1 node THẬT -> não lớn dần khi tạo thêm lịch (sáng ~8s khi vừa chạy)
  for (const s of scheds) {
    leaves.push({ id: 'sched_' + s.id, label: s.name, zone: 'z_dev', group: 'voice', val: 8, active: !!s.lastRun && Date.now() - (s.lastRun || 0) < 8000, status: 'live' })
  }

  // agent-machine: mỗi DỰ ÁN = 1 node (z_dev) — task chạy -> sáng + vào running. (Neural lớn dần theo số dự án.)
  const amRunning: { model: string; prompt: string; elapsed: number }[] = []
  try {
    const r = await amFetch('/state'); const st: any = await r.json()
    const cards: any[] = st.cards || []
    const working = cards.filter((c) => c.status === 'working')
    for (const p of (st.projects || []) as any[]) {
      if (p.trashed) continue
      const pc = cards.filter((c) => (c.projectId || 'default') === p.id)
      leaves.push({ id: 'proj_' + p.id, label: p.name, zone: 'z_dev', group: 'api', val: 10, active: pc.some((c) => c.status === 'working' || c.status === 'waiting_human'), load: pc.filter((c) => c.status === 'working').length, status: 'live' })
    }
    for (const c of working) amRunning.push({ model: c.modelOverride === 'opus' ? 'opus' : 'sonnet', prompt: c.title, elapsed: c.updatedAt ? Math.floor((Date.now() - c.updatedAt) / 1000) : 0 })
    const amSon = working.filter((c) => c.modelOverride !== 'opus').length
    const amOpu = working.filter((c) => c.modelOverride === 'opus').length
    const son = leaves.find((l) => l.id === 'sonnet'); if (son && amSon) { son.active = true; son.load = (son.load || 0) + amSon }
    const opu = leaves.find((l) => l.id === 'opus'); if (opu && amOpu) { opu.active = true; opu.load = (opu.load || 0) + amOpu }
  } catch { /* agent-machine offline -> bỏ qua */ }

  const nodes: any[] = [{ id: 'lucy', label: 'L.U.C.Y', group: 'core', val: 28, active: running.length > 0 || amRunning.length > 0, status: 'live' }]
  const links: any[] = []
  for (const z of ZONES) {
    const kids = leaves.filter((l) => l.zone === z.id)
    if (!kids.length) continue
    const zActive = kids.some((k) => k.active)
    const zFlow = kids.reduce((s, k) => s + (k.load || 0), 0)
    nodes.push({ id: z.id, label: z.label, group: 'zone', val: 15, active: zActive, status: 'live' })
    links.push({ source: 'lucy', target: z.id, flow: zFlow, active: zActive })
    for (const k of kids) { nodes.push(k); links.push({ source: z.id, target: k.id, flow: k.load || 0, active: !!k.active }) }
  }
  // mạng lưới: vòng nối các zone + vài cross-link node live -> rậm như neuron
  const zoneIds = nodes.filter((n) => n.group === 'zone').map((n) => n.id)
  for (let i = 0; i < zoneIds.length; i++) links.push({ source: zoneIds[i], target: zoneIds[(i + 1) % zoneIds.length], flow: 0, active: false })
  const has = (id: string) => nodes.some((n) => n.id === id)
  for (const [a, b] of [['hub', 'sonnet'], ['hub', 'opus'], ['telegram', 'aki'], ['aki', 'opus']]) {
    if (has(a) && has(b)) links.push({ source: a, target: b, flow: 0, active: false })
  }
  res.json({
    nodes, links, ts: Date.now(),
    running: [...running.map((j) => ({ model: j.model, prompt: j.prompt, elapsed: Math.floor((Date.now() - j.t0) / 1000) })), ...amRunning],
  })
})

app.get('/api/tree', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const dir = safePath(String(req.query.path || '.'))
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return res.status(400).json({ error: 'badpath' })
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  res.json({ root: PROJECTS, path: path.relative(PROJECTS, dir) || '.', entries })
})

app.get('/api/file', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const fp = safePath(String(req.query.path || ''))
  if (!fp || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return res.status(400).json({ error: 'badpath' })
  const size = fs.statSync(fp).size
  if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|exe|bin|woff2?|mp[34]|mov|class|jar)$/i.test(fp)) return res.json({ binary: true, size })
  if (size > 500 * 1024) return res.json({ binary: false, tooBig: true, size })
  res.json({ binary: false, name: path.basename(fp), content: fs.readFileSync(fp, 'utf-8').slice(0, 200000) })
})

// ---- SCHEDULES (đặt lịch chạy prompt) ----
type Sched = { id: string; name: string; prompt: string; model: string; times: string[]; enabled: boolean; lastRun: number | null; lastStatus: string; lastResult: string; lastKey?: string }
let scheds: Sched[] = readJSON<Sched[]>(SCHED_FILE, [])
const saveScheds = () => writeJSON(SCHED_FILE, scheds)

async function pushTelegram(text: string) {
  if (!TG_TOKEN || !TG_CHAT) return
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: text.slice(0, 3800), link_preview_options: { is_disabled: true } }),
    })
  } catch { /* */ }
}

async function fireSchedule(s: Sched, manual = false) {
  logEvent('info', 'schedule', `⏰ chạy "${s.name}"${manual ? ' (thủ công)' : ''}`)
  const id = randomBytes(8).toString('base64url')
  jobs.set(id, { status: 'running', result: null, model: s.model, t0: Date.now(), session_id: null, prompt: `[lịch] ${s.name}` })
  const { text } = await runClaude(s.prompt, null, s.model)
  const j = jobs.get(id); if (j) { j.result = text; j.status = 'done' }
  s.lastRun = Date.now(); s.lastStatus = text.startsWith('❌') ? 'error' : 'ok'; s.lastResult = text.slice(0, 400); saveScheds()
  logEvent(s.lastStatus === 'ok' ? 'info' : 'error', 'schedule', `${s.lastStatus === 'ok' ? '✓' : '✗'} "${s.name}"`)
  await pushTelegram(`🗓️ Lucy — ${s.name}\n\n${text}`)
}

app.get('/api/schedules', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  res.json({ schedules: scheds, push: !!(TG_TOKEN && TG_CHAT) })
})
app.post('/api/schedules', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const b = req.body || {}
  const name = String(b.name || '').trim(); const prompt = String(b.prompt || '').trim()
  if (!name || !prompt) return res.status(400).json({ error: 'thiếu name/prompt' })
  const times = (Array.isArray(b.times) ? b.times : String(b.times || '').split(','))
    .map((t: string) => t.trim()).filter((t: string) => /^\d{1,2}:\d{2}$/.test(t))
  const s: Sched = { id: randomBytes(6).toString('base64url'), name, prompt, model: b.model === 'opus' ? 'opus' : 'sonnet', times, enabled: true, lastRun: null, lastStatus: '', lastResult: '' }
  scheds.push(s); saveScheds(); logEvent('info', 'schedule', `+ tạo lịch "${name}" [${times.join(', ')}]`)
  res.json({ ok: true, schedule: s })
})
app.patch('/api/schedules/:id', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const s = scheds.find((x) => x.id === req.params.id); if (!s) return res.status(404).json({ error: 'nf' })
  if (typeof req.body?.enabled === 'boolean') s.enabled = req.body.enabled
  saveScheds(); res.json({ ok: true })
})
app.delete('/api/schedules/:id', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  scheds = scheds.filter((x) => x.id !== req.params.id); saveScheds(); res.json({ ok: true })
})
app.post('/api/schedules/:id/run', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const s = scheds.find((x) => x.id === req.params.id); if (!s) return res.status(404).json({ error: 'nf' })
  fireSchedule(s, true); res.json({ ok: true })
})

// ---- CRON hệ thống (chỉ xem) — surface crontab -l vào tab Schedule ----
function cronTimes(min: string, hour: string): string[] {
  if (min === '*' || hour === '*') return []
  const out: string[] = []
  for (const h of hour.split(',')) for (const m of min.split(',')) {
    if (/^\d{1,2}$/.test(h) && /^\d{1,2}$/.test(m)) out.push(`${h.padStart(2, '0')}:${m.padStart(2, '0')}`)
  }
  return out
}
function readCrontab(): Promise<{ times: string[]; schedule: string; command: string; label: string; raw: string }[]> {
  return new Promise((resolve) => {
    const child = spawn('crontab', ['-l'])
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.on('error', () => resolve([]))
    child.on('close', () => {
      const rows: { times: string[]; schedule: string; command: string; label: string; raw: string }[] = []
      for (const line of out.split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const m = t.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/)
        if (!m) continue
        const [, min, hour, dom, mon, dow, command] = m
        const cmd = command.replace(/\s*>>?.*$/, '').trim()   // bỏ phần redirect log
        const label = (cmd.split(/\s+/)[0].split('/').pop() || cmd).replace(/\.\w+$/, '')
        rows.push({ times: cronTimes(min, hour), schedule: `${min} ${hour} ${dom} ${mon} ${dow}`, command: cmd, label, raw: t })
      }
      resolve(rows)
    })
  })
}
app.get('/api/crontab', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  res.json({ crons: await readCrontab() })
})

// scheduler tick: mỗi 30s, bắn lịch tới giờ (1 lần / time / ngày, theo giờ VN)
setInterval(() => {
  const now = new Date(Date.now() + TZ_OFFSET * 3600 * 1000)
  const hhmm = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`
  const dayKey = now.toISOString().slice(0, 10)
  for (const s of scheds) {
    if (!s.enabled) continue
    if (s.times.some((t) => t.padStart(5, '0') === hhmm)) {
      const key = `${dayKey}T${hhmm}`
      if (s.lastKey !== key) { s.lastKey = key; saveScheds(); fireSchedule(s) }
    }
  }
}, 30000)

// ---- Agent-Machine (Board + Channels) proxy → coordinator ----
const amOn = () => !!AM_URL
async function amFetch(p: string, init?: { method?: string; body?: string }) {
  const headers: Record<string, string> = {}
  if (AM_TOKEN) headers['x-worker-token'] = AM_TOKEN
  if (init?.body) headers['content-type'] = 'application/json'
  return fetch(AM_URL + p, { method: init?.method || 'GET', headers, body: init?.body })
}
// B1 — token consolidation: cộng token tiêu của MỌI đường hub (claude-path + lane + prompt-architect)
// vào token-guard CHUNG (NGUỒN DUY NHẤT ở coordinator). Fire-and-forget — không chặn response, lỗi → bỏ qua.
// Tắt = LUCY_TOKEN_REPORT=0. Coordinator lane KHÔNG tự cộng → đây là chỗ DUY NHẤT cộng lane của hub (hết double-count).
const TOKEN_REPORT = !['0', 'false', 'off'].includes(String(process.env.LUCY_TOKEN_REPORT ?? '1').trim().toLowerCase())
// DASH-FIX S2: gửi /spend đủ trường (source+model+cache tách). inTok = input "tươi" (KHÔNG gộp cache); cache tách cacheRead/cacheWrite.
function reportTok(inTok?: number, outTok?: number, opts?: { source?: string; model?: string; cacheReadTok?: number; cacheWriteTok?: number }) {
  if (!TOKEN_REPORT || !amOn()) return
  const i = Math.max(0, Number(inTok) || 0)
  const o = Math.max(0, Number(outTok) || 0)
  const cr = Math.max(0, Number(opts?.cacheReadTok) || 0)
  const cw = Math.max(0, Number(opts?.cacheWriteTok) || 0)
  if (i <= 0 && o <= 0 && cr <= 0 && cw <= 0) return
  amFetch('/spend', { method: 'POST', body: JSON.stringify({ source: opts?.source || 'hub', model: opts?.model || 'unknown', inTok: i, outTok: o, cacheReadTok: cr, cacheWriteTok: cw }) }).catch(() => {})
}
// PHASE 0: prefetch recall — tra memory vault (coordinator POST /recall) trước khi gọi claude.
// Trả khối '🧠 Trí nhớ liên quan' (cap 5 hit / ~800 ký tự) để prepend vào prompt. Tắt = LUCY_RECALL_PREFETCH=0.
const RECALL_PREFETCH = !['0', 'false', 'off', ''].includes(String(process.env.LUCY_RECALL_PREFETCH ?? '1').trim().toLowerCase())
// P2: env-hoá knob (đồng bộ tên với bridge Python — 1 env chỉnh cả 2 đường vào) + fail-loud ra stderr.
const R_MAX = Number(process.env.LUCY_RECALL_MAX) || 5
const R_TIMEOUT_MS = (Number(process.env.LUCY_RECALL_TIMEOUT) || 4) * 1000
const R_BUDGET = Number(process.env.LUCY_RECALL_BUDGET) || 800
const R_HITS = Number(process.env.LUCY_RECALL_HITS) || 5
const R_SNIPPET = Number(process.env.LUCY_RECALL_SNIPPET) || 200
const R_FAILLOUD = String(process.env.LUCY_RECALL_FAILLOUD ?? '1').trim() === '1'
// P3 provenance: gắn ⟨file · tuổi⟩ vào từng hit — trí nhớ từ ĐÂU, cũ/mới, kiểm chứng được. Tắt = LUCY_RECALL_PROVENANCE=0. (Parity với bridge Python.)
const R_PROV = String(process.env.LUCY_RECALL_PROVENANCE ?? '1').trim() === '1'
// PHASE 2: ngưỡng điểm liên quan (0..1) — hit dưới ngưỡng coi như nhiễu, không chèn. 0 = tắt lọc.
const R_MIN_SCORE = Number(process.env.LUCY_RECALL_MIN_SCORE ?? 0.35)
async function recallPrefetch(text: string): Promise<string> {
  if (!RECALL_PREFETCH || !amOn() || !text.trim()) return ''
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), R_TIMEOUT_MS)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (AM_TOKEN) headers['x-worker-token'] = AM_TOKEN
    const r = await fetch(AM_URL + '/recall', { method: 'POST', headers, body: JSON.stringify({ q: text.slice(0, 500), limit: R_MAX }), signal: ctl.signal })
    clearTimeout(t)
    if (!r.ok) throw new Error(`coordinator /recall HTTP ${r.status}`)
    const hits = ((await r.json()) as any)?.hits || []
    let budget = R_BUDGET
    const lines: string[] = []
    for (const h of hits.slice(0, R_HITS)) {
      // PHASE 2 (2026-08-16): trước đây hub chèn THẲNG top-5 không lọc gì → nhiễu nặng hơn cả Telegram.
      // Nay dùng NGƯỠNG ĐIỂM liên quan (rerank/rrf) như bridge; hit không có điểm thì giữ như cũ.
      // Chỉ tin tuyệt đối điểm 'rerank' (0..1 so được giữa các câu hỏi). 'rrf' là thứ hạng chuẩn hoá
      // trong CÙNG câu hỏi (top luôn = 1.0) → lấy ngưỡng chặn vô nghĩa, bỏ qua.
      const score = h.score
      if (h.scoreKind === 'rerank' && score != null && Number(score) < R_MIN_SCORE) continue
      const title = String(h.title || h.file_path || '').trim()
      // E2: note phiên có khung [goal]/[done]/[pending] → dùng khung thay mảnh snippet rời rạc.
      const snip = String(h.bookend || h.snippet || '').replace(/\s+/g, ' ').trim().slice(0, R_SNIPPET)
      let item = snip ? `- ${title}: ${snip}` : `- ${title}`
      if (R_PROV) {                                  // P3 provenance: ⟨file · tuổi⟩ — nguồn thật, kiểm chứng được
        const src = String(h.file_path || '').trim()
        if (src) {
          let mt = Number(h.mtime) || 0
          if (mt > 1e12) mt /= 1000                  // mtime ms → s
          const d = mt > 0 ? Math.max(0, Math.floor((Date.now() / 1000 - mt) / 86400)) : -1
          const age = d < 0 ? '' : d === 0 ? ' · hôm nay' : ` · ${d}d trước`
          item += ` ⟨${src}${age}⟩`
        }
      }
      if (budget - item.length < 0) break
      budget -= item.length
      lines.push(item)
    }
    if (!lines.length) return ''
    return '🧠 Trí nhớ liên quan (tra tự động từ vault — dùng nếu hữu ích, bỏ qua nếu lạc đề):\n' + lines.join('\n') + '\n\n'
  } catch (e: any) {
    // P2 FAIL-LOUD: recall chết thì phải THẤY trong log (chat vẫn chạy, nhưng KHÔNG có trí nhớ).
    if (R_FAILLOUD) console.error(`[hub] RECALL FAIL (chat vẫn chạy, KHÔNG có trí nhớ): ${e?.name || 'Error'}: ${e?.message || e}`)
    return ''
  }
}
// PHASE 2: episodic — ghi turn hội thoại Hub vào memory.db (coordinator POST /episodic), fire-and-forget.
// Tắt = LUCY_EPISODIC=0. Lỗi/coordinator off → bỏ qua (không chặn chat).
const EPISODIC = !['0', 'false', 'off', ''].includes(String(process.env.LUCY_EPISODIC ?? '1').trim().toLowerCase())
function episodicLog(role: string, content: string, sessionId?: string | null) {
  if (!EPISODIC || !amOn() || !content || !content.trim()) return
  const safe = scrubSecrets(content)   // BẢO MẬT: giấu key/token trước khi lưu turn
  amFetch('/episodic', { method: 'POST', body: JSON.stringify({ source: 'hub', chat_id: 'hub', role, content: safe.slice(0, 8000), session_id: sessionId || '' }) }).catch(() => { /* fire-and-forget */ })
}
// BẢO MẬT: scrub secret khỏi text trước khi ghi episodic turn (mirror redact.ts/scrub_secrets bridge).
const SECRET_RULES: { re: RegExp; repl: string }[] = [
  { re: /\bBearer\s+[A-Za-z0-9._\-]{8,}/gi, repl: 'Bearer [REDACTED]' },
  { re: /\b(?:sk|rk|pk)-[A-Za-z0-9_\-]{16,}/g, repl: '[REDACTED]' },
  { re: /\bjina_[A-Za-z0-9]{16,}/g, repl: '[REDACTED]' },
  { re: /\b(?:ghp|gho|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}/g, repl: '[REDACTED]' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, repl: '[REDACTED]' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, repl: '[REDACTED]' },
  { re: /\b([A-Za-z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|ACCESS[_-]?KEY))\s*[=:]\s*\S+/gi, repl: '$1=[REDACTED]' },
]
function scrubSecrets(text: string): string {
  if (!text) return text
  let s = text
  for (const { re, repl } of SECRET_RULES) s = s.replace(re, repl)
  s = s.replace(/[A-Za-z0-9+/_\-]{40,}={0,2}/g, (m) => {
    const hasB64 = /[+/=]/.test(m), hasUpper = /[A-Z]/.test(m), hasLower = /[a-z]/.test(m), hasDigit = /[0-9]/.test(m)
    return hasB64 || (hasUpper && hasLower && hasDigit) ? '[REDACTED]' : m
  })
  return s
}
// K2 consult_expert MCP server in-process cho claude-path (#3 minh bạch: tool_use event hiện card UI).
// Handler gọi coordinator /consult-expert khi Claude chọn dùng tool này.
const expertMcpServer = createSdkMcpServer({
  name: 'lucy-experts',
  alwaysLoad: true,
  instructions: 'Gọi consult_expert khi cần góc chuyên sâu từ expert persona (finance·marketing·researcher·designer·data·architect·engineer·security·investigator·devops·tester·writer).',
  tools: [{
    name: 'consult_expert',
    description: 'Hỏi 1 EXPERT chuyên lĩnh vực rồi dệt góc nhìn đó vào câu trả lời. Dùng khi cần chuyên sâu ngoài thế mạnh của mình.',
    inputSchema: {
      persona: z.string().describe('id expert: finance(tài chính) | marketing | researcher | designer(UI/UX) | data | architect | engineer | security(audit) | investigator(root-cause/debug) | devops(deploy/CI) | tester(QA) | writer(docs)'),
      question: z.string().describe('câu hỏi/yêu cầu cụ thể cho expert'),
    },
    handler: async ({ persona, question }: { persona: string; question: string }) => {
      try {
        if (!AM_URL) return { content: [{ type: 'text' as const, text: 'coordinator chưa cấu hình (AM_COORD_URL) — consult không khả dụng' }] }
        const r = await amFetch('/consult-expert', { method: 'POST', body: JSON.stringify({ persona, question }) })
        const d = await r.json() as any
        return { content: [{ type: 'text' as const, text: d.answer || d.error || '(rỗng)' }] }
      } catch (e) {
        return { content: [{ type: 'text' as const, text: 'consult lỗi: ' + String(e).slice(0, 200) }], isError: true }
      }
    },
  }],
} as any)

app.get('/api/metrics', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.json({ configured: false, tokenDay: 0, tokenMonth: 0, costDay: 0, costMonth: 0, costByModel: [], costByAgent: [], costByCard: [], cardsRunning: 0, cardsWaiting: 0, cardsTotal: 0, providers: [], alerts: [] })
  try { const r = await amFetch('/metrics'); res.json({ configured: true, ...(await r.json()) }) }
  catch (e) { res.json({ configured: true, offline: true, tokenDay: 0, tokenMonth: 0, costDay: 0, costMonth: 0, costByModel: [], costByAgent: [], costByCard: [], cardsRunning: 0, cardsWaiting: 0, cardsTotal: 0, providers: [], alerts: [], error: String(e).slice(0, 120) }) }
})
app.get('/api/error-stats', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.json({ configured: false, total: 0, byCategory: [], byAgent: [], byModel: [], topCategory: null, scope: '' })
  try { const r = await amFetch('/error-stats'); res.json({ configured: true, ...(await r.json()) }) }
  catch (e) { res.json({ configured: true, offline: true, total: 0, byCategory: [], byAgent: [], byModel: [], topCategory: null, scope: '', error: String(e).slice(0, 120) }) }
})
app.get('/api/am/state', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.json({ configured: false, cards: [], channels: [] })
  try { const r = await amFetch('/state'); res.json({ configured: true, ...(await r.json()) }) }
  catch (e) { res.json({ configured: true, offline: true, cards: [], channels: [], error: String(e).slice(0, 120) }) }
})
// Phase D (D2/D4): catalog model + trạng thái rate-guard/quota → cho composer picker + Dashboard panel.
app.get('/api/llm/models', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.json({ configured: false, catalog: [], providers: [], routeTable: {}, router: '' })
  try { const r = await amFetch('/llm/models'); res.json({ configured: true, ...(await r.json()) }) }
  catch (e) { res.json({ configured: true, offline: true, catalog: [], providers: [], routeTable: {}, router: '', error: String(e).slice(0, 120) }) }
})
app.get('/api/llm/guard', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.json({ configured: false, guarded: [], quota: {} })
  try { const r = await amFetch('/llm/guard'); res.json({ configured: true, ...(await r.json()) }) }
  catch (e) { res.json({ configured: true, offline: true, guarded: [], quota: {}, error: String(e).slice(0, 120) }) }
})
// BH-D meta-learning: gửi feedback 👍/👎 cho model → routing tự học; xem bảng outcome đã học.
app.post('/api/llm/feedback', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.json({ ok: false, error: 'coordinator chưa cấu hình' })
  try { const r = await amFetch('/llm/feedback', { method: 'POST', body: JSON.stringify(req.body || {}) }); res.json(await r.json()) }
  catch (e) { res.json({ ok: false, error: String(e).slice(0, 120) }) }
})
app.get('/api/llm/outcomes', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.json({ configured: false, stats: [], total: 0 })
  try { const r = await amFetch('/llm/outcomes'); res.json({ configured: true, ...(await r.json()) }) }
  catch (e) { res.json({ configured: true, offline: true, stats: [], total: 0, error: String(e).slice(0, 120) }) }
})
// K4 persona registry: CRUD expert qua Hub (proxy → coordinator /personas)
app.get('/api/personas', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.json({ configured: false, personas: [] })
  try { const r = await amFetch('/personas'); res.json({ configured: true, ...(await r.json()) }) }
  catch (e) { res.json({ configured: true, offline: true, personas: [], error: String(e).slice(0, 120) }) }
})
app.post('/api/personas', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.status(400).json({ error: 'Agent-Machine chưa cấu hình (AM_COORD_URL)' })
  try { const r = await amFetch('/personas', { method: 'POST', body: JSON.stringify(req.body || {}) }); res.status(r.status).json(await r.json()) }
  catch (e) { res.status(502).json({ error: String(e).slice(0, 120) }) }
})
app.delete('/api/personas/:id', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.status(400).json({ error: 'Agent-Machine chưa cấu hình (AM_COORD_URL)' })
  try { const r = await amFetch('/personas?id=' + encodeURIComponent(req.params.id), { method: 'DELETE' }); res.status(r.status).json(await r.json()) }
  catch (e) { res.status(502).json({ error: String(e).slice(0, 120) }) }
})

// M3.5 persona chat đa lượt + auto-routing (proxy → coordinator). Flag LUCY_PERSONA_CHAT ở coordinator.
app.post('/api/persona/chat', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.status(400).json({ error: 'Agent-Machine chưa cấu hình (AM_COORD_URL)' })
  try { const r = await amFetch('/persona-chat', { method: 'POST', body: JSON.stringify(req.body || {}) }); res.status(r.status).json(await r.json()) }
  catch (e) { res.status(502).json({ error: String(e).slice(0, 120) }) }
})
app.post('/api/persona/route', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.status(400).json({ error: 'Agent-Machine chưa cấu hình (AM_COORD_URL)' })
  try { const r = await amFetch('/persona-route', { method: 'POST', body: JSON.stringify(req.body || {}) }); res.status(r.status).json(await r.json()) }
  catch (e) { res.status(502).json({ error: String(e).slice(0, 120) }) }
})

// T5 MCP "Kết nối": trạng thái server MCP (proxy → coordinator /mcp)
app.get('/api/mcp', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.json({ configured: false, masterOn: false, servers: [] })
  try { const r = await amFetch('/mcp'); res.json({ configured: true, ...(await r.json()) }) }
  catch (e) { res.json({ configured: true, offline: true, masterOn: false, servers: [], error: String(e).slice(0, 120) }) }
})

// T6 Skill "Kỹ năng": active (INDEX) + proposed (_proposed, M3.3) (proxy → coordinator /skills)
app.get('/api/skills', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.json({ configured: false, learnOn: false, active: [], proposed: [] })
  try { const r = await amFetch('/skills'); res.json({ configured: true, ...(await r.json()) }) }
  catch (e) { res.json({ configured: true, offline: true, learnOn: false, active: [], proposed: [], error: String(e).slice(0, 120) }) }
})

// Phase D (D1+D2+D3): chat STREAMING qua SSE. model = claude:sonnet|claude:opus | auto | <lane-key>.
// claude → stream-json (chữ chạy thật). lane → coordinator /chat-lane (nhanh, trả 1 cục). auto → /route rồi dispatch.
const LANE_KEYS = new Set<string>()
const TOOL_LANE_KEYS = new Set<string>()   // M4: lane model hỗ trợ tool-calling → đi đường agentic (có web/file/bash)
// L2 (Hermes parity): lane model STATELESS → tự gửi persona (system) + LỊCH SỬ hội thoại để nối mạch + giữ persona.
// L3: compressor — token-aware sliding window thay cap cứng 24 msg.
const LANE_CTX_TOKENS = 5000   // ngân sách tối ước token
const LANE_VERBATIM_MIN = 6    // tối thiểu N tin gần nhất giữ nguyên
function estimateTok(text: string): number { return Math.ceil((text || '').length / 4) }
function buildLaneMessages(): { role: string; content: string }[] {
  const sys = fs.existsSync(PERSONA) ? fs.readFileSync(PERSONA, 'utf8') : ''
   const all = chat.messages
  if (!all.length) return sys ? [{ role: 'system', content: sys }] : []
  let budget = LANE_CTX_TOKENS
  let start = all.length
  for (let i = all.length - 1; i >= 0; i--) {
    const tok = estimateTok(all[i].text)
    if (budget - tok < 0 && all.length - start >= LANE_VERBATIM_MIN) break
    budget -= tok
    start = i
  }
  const verbatim = all.slice(start).map((m) => ({ role: m.role === 'lucy' ? 'assistant' : 'user', content: m.text }))
  const older = all.slice(0, start)
  let sysContent = sys
  if (older.length > 0) {
    const lines = older.map((m) => `• [${m.role === 'me' ? 'Chủ nhân' : 'Lucy'}] ${m.text.trim().slice(0, 180)}`).join('\n')
    sysContent += `\n\n--- Hội thoại trước (${older.length} tin, tóm gọn) ---\n${lines}\n---`
  }
  return sysContent ? [{ role: 'system', content: sysContent }, ...verbatim] : verbatim
}
app.post('/api/chat/stream', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const prompt = String(req.body?.prompt || '').trim()
  if (!prompt) return res.status(400).json({ error: 'empty' })
  let model = String(req.body?.model || 'claude:sonnet').trim()
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' })
  const sse = (ev: Record<string, unknown>) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`) } catch { /* client ngắt */ } }
  let closed = false
  res.on('close', () => { closed = true }) // res (KHÔNG phải req — req 'close' fire ngay sau khi đọc body → chặn nhầm delta)
  // refresh danh sách lane key (1 lần / khi rỗng) để phân biệt lane vs claude
  if (!LANE_KEYS.size && amOn()) {
    try {
      const d = await (await amFetch('/llm/models')).json() as any
      for (const m of d.catalog || []) LANE_KEYS.add(m.key)
      // M4: model tool-capable = role dùng tool (tool-calling/agentic-code/reasoning/long-context). content/fast-classify → chat thuần.
      const rt = d.routeTable || {}
      for (const role of ['tool-calling', 'agentic-code', 'reasoning', 'long-context']) for (const k of (rt[role] || [])) TOOL_LANE_KEYS.add(k)
    } catch { /* */ }
  }
  // đăng ký job nhẹ để chat hiện ở tab Tasks (stream cũng là 1 task đang chạy)
  const jobId = randomBytes(8).toString('base64url')
  jobs.set(jobId, { status: 'running', result: null, model, t0: Date.now(), session_id: chat.sessionId, prompt: prompt.slice(0, 120) })
  const finishJob = (result: string, sid?: string | null) => { const j = jobs.get(jobId); if (j) { j.status = 'done'; j.result = result; j.model = model; if (sid) j.session_id = sid } }
  try {
    chat.messages.push({ role: 'me', text: prompt, t: Date.now() }); saveChat()
    episodicLog('user', prompt, chat.sessionId)   // PHASE 2: ghi turn người dùng (async)
    // AUTO: router quyết role/model/needsTools
    if (model === 'auto') {
      // D7: phiên ĐÃ CÓ context (sessionId) → KHÔNG hạ xuống lane rẻ (lane stateless, mất persona+lịch sử → hỏng mạch).
      // Chỉ route lane cho câu MỚI/độc lập (chưa có session). Giữ mạch phiên trên claude (có --resume).
      if (chat.sessionId) { sse({ type: 'route', text: '🧭 auto → claude (giữ mạch phiên đang có)' }); model = 'claude:sonnet' }
      else if (!amOn()) { model = 'claude:sonnet' }
      else {
        try {
          const dec = await (await amFetch('/route', { method: 'POST', body: JSON.stringify({ brief: prompt }) })).json() as any
          if (dec?.error || dec?.needsTools) { sse({ type: 'route', text: `🧭 auto → claude (cần tool): ${dec?.reason || ''}` }); model = 'claude:sonnet' }
          else { sse({ type: 'route', text: `🧭 auto → ${dec.modelKey} (${dec.role}): ${dec.reason || ''}` }); model = dec.modelKey }
        } catch { model = 'claude:sonnet' }
      }
    }
    // LANE: model free/rẻ qua coordinator. L2 = persona+history. M = tool-capable → AGENTIC (web/file/bash), else chat thuần.
    if (model.startsWith('claude') === false && LANE_KEYS.has(model)) {
      if (!amOn()) { sse({ type: 'error', text: 'coordinator chưa cấu hình' }); return res.end() }
      try {
        if (TOOL_LANE_KEYS.has(model)) {
          // M: lane agentic — model rẻ tự web_search/web_fetch/read/bash. Trả {answer, trace, usage}.
          const r = await (await amFetch('/chat-lane-agentic', { method: 'POST', body: JSON.stringify({ model, messages: buildLaneMessages() }) })).json() as any
          if (r?.error) { sse({ type: 'error', text: r.error }); finishJob('❌ ' + r.error) }
          else {
            // #3 minh bạch: hiện tool-card (gửi gì / nhận gì) — khớp UI Section A theo id.
            (r.trace || []).forEach((t: any, i: number) => {
              sse({ type: 'tool_use', name: t.name, input: t.input, id: 'lt' + i })
              sse({ type: 'tool_result', id: 'lt' + i, text: t.result })
            })
            if (r.usage) { sse({ type: 'usage', inTok: r.usage.inTok, cacheTok: 0, outTok: r.usage.outTok }); reportTok(r.usage.inTok, r.usage.outTok, { source: 'lane', model }) }   // DASH-FIX S2: lane agentic → /spend (source=lane, model thật)
            sse({ type: 'delta', text: r.answer || '(rỗng)' })
            chat.messages.push({ role: 'lucy', text: r.answer || '(rỗng)', t: Date.now() }); saveChat()
            episodicLog('assistant', r.answer || '', chat.sessionId)
            finishJob(r.answer || '(rỗng)')
          }
        } else {
          const r = await (await amFetch('/chat-lane', { method: 'POST', body: JSON.stringify({ model, messages: buildLaneMessages() }) })).json() as any
          if (r?.error) { sse({ type: 'error', text: r.error }); finishJob('❌ ' + r.error) }
          else {
            if (r.thinking) sse({ type: 'thinking', text: String(r.thinking).slice(0, 2000) })
            if (r.usage) { sse({ type: 'usage', inTok: r.usage.inTok, cacheTok: 0, outTok: r.usage.outTok }); reportTok(r.usage.inTok, r.usage.outTok, { source: 'lane', model }) }   // DASH-FIX S2: lane chat → /spend (source=lane, model thật)
            sse({ type: 'delta', text: r.answer || '(rỗng)' })
            chat.messages.push({ role: 'lucy', text: r.answer || '(rỗng)', t: Date.now() }); saveChat()
            episodicLog('assistant', r.answer || '', chat.sessionId)
            finishJob(r.answer || '(rỗng)')
          }
        }
      } catch (e) { sse({ type: 'error', text: 'lane lỗi: ' + String(e).slice(0, 120) }); finishJob('❌ lane lỗi') }
      sse({ type: 'done', model }); return res.end()
    }
    // CLAUDE: stream-json (chữ chạy thật) — dùng subscription, giữ session chat.
    const cm = model === 'claude:opus' ? 'opus' : 'sonnet'
    // PHASE 0: chèn khối memory liên quan vào đầu prompt (lỗi/tắt flag → '' → prompt nguyên gốc).
    const cprompt = (await recallPrefetch(prompt)) + prompt
    let out = await streamClaude(cprompt, chat.sessionId, cm, (e) => { if (!closed) sse(e) })
    // resume hỏng (session cũ/khác process → claude trả rỗng) → chạy lại KHÔNG resume (như bridge ClaudeRunner)
    if (chat.sessionId && !out.sid && (!out.text || out.text === '(rỗng)')) {
      out = await streamClaude(cprompt, null, cm, (e) => { if (!closed) sse(e) })
    }
    chat.sessionId = out.sid || chat.sessionId
    chat.messages.push({ role: 'lucy', text: out.text, t: Date.now() }); saveChat()
    episodicLog('assistant', out.text, chat.sessionId)   // PHASE 2: ghi trả lời claude
    finishJob(out.text, out.sid)
    sse({ type: 'final', text: out.text, model: cm })
    sse({ type: 'done', model: cm })
  } catch (e) { sse({ type: 'error', text: String(e).slice(0, 200) }); finishJob('❌ ' + String(e).slice(0, 200)) }
  res.end()
})
app.get('/api/am/config', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!amOn()) return res.json({ configured: false })
  try { const r = await amFetch('/config'); res.json({ configured: true, ...(await r.json()) }) }
  catch { res.json({ configured: true, offline: true }) }
})
for (const [route, fwd] of [['/api/am/config', '/config'], ['/api/am/card', '/card'], ['/api/am/card/remove', '/card/remove'], ['/api/am/card/activate', '/card/activate'], ['/api/am/approve', '/approve'], ['/api/am/reject', '/reject'], ['/api/am/answer', '/answer'], ['/api/am/project', '/project'], ['/api/am/project/remove', '/project/remove'], ['/api/am/project/trash', '/project/trash'], ['/api/am/project/restore', '/project/restore'], ['/api/am/project/purge', '/project/purge'], ['/api/am/project/channel', '/project/channel'], ['/api/am/channel/post', '/channel/post'], ['/api/am/lucy/log', '/lucy/log'], ['/api/am/pipeline', '/pipeline'], ['/api/am/pipeline/remove', '/pipeline/remove']] as const) {
  app.post(route, async (req, res) => {
    if (!authed(req)) return res.status(401).json({ error: 'unauth' })
    if (!amOn()) return res.status(400).json({ error: 'Agent-Machine chưa cấu hình (AM_COORD_URL)' })
    try { const r = await amFetch(fwd, { method: 'POST', body: JSON.stringify(req.body || {}) }); res.status(r.status).json(await r.json()) }
    catch (e) { res.status(502).json({ error: 'coordinator offline: ' + String(e).slice(0, 120) }) }
  })
}

// ---- BỘ NÃO (M1: recall + vault + dream) proxy → coordinator ----
// GET có query (recall/file/recent) → forward nguyên query sang coordinator.
for (const [route, fwd] of [['/api/brain/state', '/brain/state'], ['/api/brain/graph', '/brain/graph'], ['/api/brain/recall', '/recall'], ['/api/brain/recent', '/brain/recent'], ['/api/brain/file', '/brain/file'], ['/api/llm/models', '/llm/models']] as const) {
  app.get(route, async (req, res) => {
    if (!authed(req)) return res.status(401).json({ error: 'unauth' })
    if (!amOn()) return res.json({ configured: false })
    const qs = req.url.includes('?') ? '?' + req.url.split('?')[1] : ''
    try { const r = await amFetch(fwd + qs); res.status(r.status).json(await r.json()) }
    catch (e) { res.json({ configured: true, offline: true, error: String(e).slice(0, 120) }) }
  })
}
for (const [route, fwd] of [['/api/brain/reindex', '/brain/reindex'], ['/api/brain/dream', '/brain/dream'], ['/api/brain/evidence', '/brain/evidence'], ['/api/brain/pin', '/brain/pin'], ['/api/llm/catalog-refresh', '/llm/catalog-refresh']] as const) {
  app.post(route, async (req, res) => {
    if (!authed(req)) return res.status(401).json({ error: 'unauth' })
    if (!amOn()) return res.status(400).json({ error: 'Agent-Machine chưa cấu hình (AM_COORD_URL)' })
    try { const r = await amFetch(fwd, { method: 'POST', body: JSON.stringify(req.body || {}) }); res.status(r.status).json(await r.json()) }
    catch (e) { res.status(502).json({ error: 'coordinator offline: ' + String(e).slice(0, 120) }) }
  })
}

// ---- PROMPT ARCHITECT (CỤM B, task 3) — flag LUCY_PROMPT_ARCHITECT, MẶC ĐỊNH TẮT ----
// Bộ não lõi ở agent-machine (cụm A). Hub chỉ: wire flag + stream SSE + đọc store.recent() + nút escalate.
// KHÔNG EXECUTE: core dùng callLLM thuần (no tool). Tab UI chỉ hiện khi /api/prompts/status → enabled.
const PA_CHAT_ID = 'hub-prompts'   // 1 luồng lịch sử riêng cho tab Prompts ở Hub (tách khỏi chat tổng)

app.get('/api/prompts/status', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  res.json({ enabled: promptArchitectFlagOn() })
})

// Lịch sử phiên (store.recent) — đọc trực tiếp sidecar DB cụm A. limit cap ở store (≤50).
app.get('/api/prompts/history', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!promptArchitectFlagOn()) return res.json({ enabled: false, sessions: [] })
  try {
    const store = getPromptArchitectStore(VAULT)
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50)
    const sessions = store ? store.recent({ chatId: PA_CHAT_ID, limit }) : []
    res.json({ enabled: true, sessions })
  } catch (e) { res.json({ enabled: true, sessions: [], error: String(e).slice(0, 120) }) }
})

// Chạy 1 lượt (model RẺ ds-chat). Trả SSE giống chat: delta(answer) → final → done. Core không stream từng chữ
// (callLLM trả 1 cục) → emit 1 delta. Kèm meta (clarifying/finalPrompt/sessionId) trong sự kiện final.
app.post('/api/prompts/run', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!promptArchitectFlagOn()) return res.status(403).json({ error: 'Prompt Architect đang TẮT (đặt LUCY_PROMPT_ARCHITECT=1).' })
  const context = String(req.body?.context || '').trim()
  if (!context) return res.status(400).json({ error: 'empty' })
  const targetModel = String(req.body?.targetModel || '').trim() || undefined
  const variants = Number.isFinite(Number(req.body?.variants)) ? Number(req.body.variants) : undefined  // CỤM C: ≥2 → xuất đa biến thể
  const history = sanitizeChatHistory(req.body?.history)
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' })
  const sse = (ev: Record<string, unknown>) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`) } catch { /* client ngắt */ } }
  try {
    const r = await runPromptArchitect(context, { history, targetModel, variants, source: 'hub', chatId: PA_CHAT_ID, vaultDir: VAULT })
    if (r.usage) reportTok(r.usage.inTok, r.usage.outTok, { source: 'lane', model: r.laneModel || 'unknown' })   // DASH-FIX S2: prompt-architect lane → /spend (source=lane, model thật)
    if (r.rateLimit) sse({ type: 'route', text: `⏸️ rate-limit (~${Math.round(r.rateLimit.retryAfterMs / 1000)}s)` })
    sse({ type: 'delta', text: r.answer })
    sse({ type: 'final', text: r.answer, clarifying: r.clarifying, finalPrompt: r.finalPrompt, sessionId: r.sessionId, laneModel: r.laneModel, escalated: r.escalated, scorecard: r.scorecard, variants: r.variants, preferenceApplied: r.preferenceApplied })
    sse({ type: 'done', model: r.laneModel })
    logEvent('info', 'prompt-architect', `▶ run ${r.laneModel}${r.clarifying ? ' (hỏi làm-rõ)' : ''}: ${context.slice(0, 60)}`)
  } catch (e) { sse({ type: 'error', text: String(e).slice(0, 200) }) }
  res.end()
})

// Escalate 1 phiên khó bằng Claude (model mạnh) — trả JSON (1 cục, qua SDK query 1-shot).
app.post('/api/prompts/escalate', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!promptArchitectFlagOn()) return res.status(403).json({ error: 'Prompt Architect đang TẮT (đặt LUCY_PROMPT_ARCHITECT=1).' })
  const context = String(req.body?.context || '').trim()
  if (!context) return res.status(400).json({ error: 'empty' })
  const targetModel = String(req.body?.targetModel || '').trim() || undefined
  const history = sanitizeChatHistory(req.body?.history)
  const sessionId = Number.isFinite(Number(req.body?.sessionId)) ? Number(req.body.sessionId) : undefined
  try {
    logEvent('info', 'prompt-architect', `⬆ escalate Claude: ${context.slice(0, 60)}`)
    const r = await escalatePromptArchitect(context, { history, targetModel, source: 'hub', chatId: PA_CHAT_ID, sessionId, vaultDir: VAULT })
    res.json({ answer: r.answer, clarifying: r.clarifying, finalPrompt: r.finalPrompt, sessionId: r.sessionId, laneModel: r.laneModel, escalated: r.escalated, scorecard: r.scorecard })
  } catch (e) { res.status(502).json({ error: String(e).slice(0, 200) }) }
})

// Ghi bản EDIT của chủ nhân lên 1 phiên (rewrite-then-edit).
app.post('/api/prompts/edit', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  if (!promptArchitectFlagOn()) return res.status(403).json({ error: 'Prompt Architect đang TẮT.' })
  const sessionId = Number(req.body?.sessionId)
  const edit = String(req.body?.edit || '')
  if (!Number.isFinite(sessionId) || !edit.trim()) return res.status(400).json({ error: 'cần sessionId + edit' })
  const ok = recordUserEdit(sessionId, edit, VAULT)
  res.json({ ok })
})

// ─── ATH-4: Auto-Task Hub API (read-only) ────────────────────────────────────
const AUTOTASK_PROJECTS_DIR = path.join(os.homedir(), 'lucy', 'tasks', 'projects')

function atCountDir(d: string): number {
  try { return fs.readdirSync(d).filter(f => f.endsWith('.md')).length } catch { return 0 }
}

function atParseFrontmatter(content: string): Record<string, string> {
  const meta: Record<string, string> = {}
  const m = content.match(/^---\s*\n(.*?)\n---\s*\n/s)
  if (!m) return meta
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/)
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '')
  }
  return meta
}

function atReadState(slug: string): Record<string, unknown> {
  try {
    const p = path.join(AUTOTASK_PROJECTS_DIR, slug, 'state.json')
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch { return {} }
}

function atLatestResearchDate(slug: string): string | null {
  try {
    const resDir = path.join(AUTOTASK_PROJECTS_DIR, slug, 'research')
    const dates = fs.readdirSync(resDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map(f => f.slice(0, 10))
      .sort()
    return dates.length ? dates[dates.length - 1] : null
  } catch { return null }
}

function atListProjects(): unknown[] {
  const list: unknown[] = []
  if (!fs.existsSync(AUTOTASK_PROJECTS_DIR)) return list
  for (const slug of fs.readdirSync(AUTOTASK_PROJECTS_DIR).sort()) {
    const projMd = path.join(AUTOTASK_PROJECTS_DIR, slug, 'project.md')
    if (!fs.existsSync(projMd)) continue
    const content = fs.readFileSync(projMd, 'utf-8')
    const fm = atParseFrontmatter(content)
    const state = atReadState(slug)
    const base = path.join(AUTOTASK_PROJECTS_DIR, slug)
    list.push({
      slug,
      title:               fm.title || slug,
      status:              fm.status || 'active',
      sprint_count:        (state.sprint_count as number) || 0,
      queued:              atCountDir(path.join(base, 'queue')),
      done:                atCountDir(path.join(base, 'done')),
      failed:              atCountDir(path.join(base, 'failed')),
      total_usd:           (state.total_usd as number) || 0,
      last_run:            (state.last_run as string) || null,
      latest_research_date: atLatestResearchDate(slug),
    })
  }
  return list
}

app.get('/api/autotask/projects', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  try {
    res.json({ projects: atListProjects() })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

app.get('/api/autotask/projects/:slug', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const slug = req.params.slug.replace(/[^a-z0-9_-]/gi, '')
  const base = path.join(AUTOTASK_PROJECTS_DIR, slug)
  if (!fs.existsSync(path.join(base, 'project.md'))) return res.status(404).json({ error: 'not found' })
  try {
    const projContent = fs.readFileSync(path.join(base, 'project.md'), 'utf-8')
    const fm  = atParseFrontmatter(projContent)
    const state = atReadState(slug)

    // Research history (date + excerpt 200 chars)
    const research: unknown[] = []
    const resDir = path.join(base, 'research')
    if (fs.existsSync(resDir)) {
      for (const f of fs.readdirSync(resDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse().slice(0, 10)) {
        const txt = fs.readFileSync(path.join(resDir, f), 'utf-8')
        research.push({ date: f.slice(0, 10), excerpt: txt.slice(0, 200) })
      }
    }

    // Task lists (id + title from frontmatter)
    const readTaskList = (subdir: string) => {
      const d = path.join(base, subdir)
      if (!fs.existsSync(d)) return []
      return fs.readdirSync(d).filter(f => f.endsWith('.md')).map(f => {
        const c = fs.readFileSync(path.join(d, f), 'utf-8')
        const m = atParseFrontmatter(c)
        return { id: m.id || f.slice(0, -3), title: m.title || f.slice(0, -3) }
      })
    }

    // Sprint list (n, date from filename + first line summary)
    const sprints: unknown[] = []
    const spDir = path.join(base, 'sprints')
    if (fs.existsSync(spDir)) {
      for (const f of fs.readdirSync(spDir).filter(f => /^\d+\.md$/.test(f)).sort((a, b) => Number(b.slice(0, -3)) - Number(a.slice(0, -3)))) {
        const txt = fs.readFileSync(path.join(spDir, f), 'utf-8')
        const lines = txt.split('\n').filter(l => l.trim())
        const usdMatch = txt.match(/Est\. cost: \$([0-9.]+)/)
        sprints.push({
          n:       Number(f.slice(0, -3)),
          summary: lines.slice(0, 4).join(' | ').slice(0, 200),
          usd:     usdMatch ? parseFloat(usdMatch[1]) : 0,
        })
      }
    }

    res.json({
      project: { ...fm, slug },
      state,
      research,
      tasks: {
        queue:  readTaskList('queue'),
        doing:  readTaskList('doing'),
        done:   readTaskList('done'),
        failed: readTaskList('failed'),
      },
      sprints,
    })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

// ─── Build Hub: auto-build + auto-build-free status ─────────────────────────
const LUCY_REPO = process.env.LUCY_REPO || path.join(os.homedir(), 'lucy')

function buildToolStatus(logFile: string, pidFile?: string) {
  const logPath = path.join(LUCY_REPO, logFile)
  let logTail: string[] = []
  let lastTs = ''
  try {
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean)
    logTail = lines.slice(-20)
    const last = lines[lines.length - 1] || ''
    const m = last.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/)
    if (m) lastTs = m[1]
  } catch { /* no log yet */ }

  // detect running: check PID from nohup/pgrep
  let running = false
  try {
    const r = require('child_process').execSync(
      `pgrep -f "${logFile.replace('.log', '.py')}" 2>/dev/null || true`, { timeout: 2000 }
    ).toString().trim()
    running = r.length > 0
  } catch { running = false }

  // parse current task from log
  const currentTask = logTail.slice().reverse().find(l => l.includes('--- task '))
  const sprintEnd = logTail.find(l => l.includes('SPRINT END'))

  return { running, lastTs, logTail: logTail.slice(-10), currentTask, sprintEnd }
}

app.get('/api/autobuild/status', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  res.json(buildToolStatus('auto-build.log'))
})

app.get('/api/autobuild-free/status', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  // check cả sprint 1 và sprint 2 log
  const s1 = buildToolStatus('auto-build-free.log')
  const s2 = buildToolStatus('auto-build-free-s2.log')
  const active = s2.running ? s2 : s1.running ? s1 : (s2.lastTs > s1.lastTs ? s2 : s1)
  res.json({ ...active, sprint2: s2, sprint1: s1 })
})

// auto-task queue thường (pm2 lucy-autotask) — pgrep auto-task.py tự khớp
app.get('/api/auto-task/status', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const base = buildToolStatus('auto-task.log')
  const count = (sub: string) => {
    try {
      return fs.readdirSync(path.join(LUCY_REPO, 'tasks', sub))
        .filter(f => f.endsWith('.md')).length
    } catch { return 0 }
  }
  res.json({
    ...base,
    queue:  count('queue'),
    doing:  count('doing'),
    done:   count('done'),
    failed: count('failed'),
  })
})

// ─── VPS status + Cây tri thức (kgraph) + agent dọn máy ─────────────────────
import { execSync as _execSync, execFile as _execFile } from 'node:child_process'
const sh = (cmd: string, timeout = 5000): string => {
  try { return _execSync(cmd, { timeout, maxBuffer: 8 * 1024 * 1024 }).toString() } catch { return '' }
}

// pid→ports (ss) + port→URL public (nginx proxy_pass) — cache 60s vì /api/system bị poll 5s
let portMapCache: { at: number; portByPid: Map<number, number[]>; portUrl: Map<number, string> } | null = null
function getPortMaps() {
  if (portMapCache && Date.now() - portMapCache.at < 60_000) return portMapCache
  const portByPid = new Map<number, number[]>()
  const addPort = (pid: number, port: number) => {
    const cur = portByPid.get(pid) || []
    if (!cur.includes(port)) portByPid.set(pid, [...cur, port])
  }
  for (const line of sh('ss -ltnp').split('\n').slice(1)) {
    const port = Number(line.match(/[\d.*\]]+:(\d+)\s/)?.[1] || 0)
    const pid = Number(line.match(/pid=(\d+)/)?.[1] || 0)
    if (!port || !pid) continue
    addPort(pid, port)
    // pm2 chạy qua wrapper (tsx/npm) → thằng listen là con; lan port lên chuỗi cha (≤3 cấp)
    let cur = pid
    for (let i = 0; i < 3; i++) {
      let ppid = 0
      try { ppid = Number(fs.readFileSync(`/proc/${cur}/stat`, 'utf-8').split(') ')[1]?.split(' ')[1] || 0) } catch { break }
      if (ppid <= 1) break
      addPort(ppid, port)
      cur = ppid
    }
  }
  const portUrl = new Map<number, string>()
  try {
    for (const f of fs.readdirSync('/etc/nginx/sites-enabled')) {
      let txt = ''
      try { txt = fs.readFileSync('/etc/nginx/sites-enabled/' + f, 'utf-8') } catch { continue }
      const domain = txt.match(/server_name\s+([^;]+);/)?.[1].trim().split(/\s+/)[0] || ''
      if (!domain || domain === '_' || !domain.includes('.')) continue
      const proto = /listen\s+[^;]*443/.test(txt) ? 'https' : 'http'
      // server block listen port khác 80/443 (vd pxpipe dashboard :47822) → phải kèm :port vào URL
      const listenPort = Number(txt.match(/listen\s+(?:\[::\]:)?(\d+)/)?.[1] || 0)
      const std = listenPort === 80 || listenPort === 443 || !listenPort
      const suffix = std ? '' : `:${listenPort}`
      for (const [, loc, body] of txt.matchAll(/location\s+=?\s*([^\s{]+)\s*\{([^}]*)/g)) {
        const port = Number(body.match(/proxy_pass\s+https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/)?.[1] || 0)
        if (port && loc.startsWith('/') && (loc === '/' || !portUrl.has(port)))
          portUrl.set(port, `${proto}://${domain}${suffix}${loc === '/' ? '' : loc}`)
      }
    }
  } catch { /* không có nginx */ }
  portMapCache = { at: Date.now(), portByPid, portUrl }
  return portMapCache
}

// GET /api/system — chỉ số sống của VPS (tab VPS poll 5s → phải rẻ: os.* + 3 lệnh nhanh)
app.get('/api/system', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const load = os.loadavg()
  // MemAvailable từ /proc/meminfo chuẩn hơn os.freemem (tính cả cache reclaim được)
  let memAvail = os.freemem()
  try {
    const m = fs.readFileSync('/proc/meminfo', 'utf-8').match(/MemAvailable:\s+(\d+) kB/)
    if (m) memAvail = Number(m[1]) * 1024
  } catch { /* fallback freemem */ }
  let swapTotal = 0, swapFree = 0
  try {
    const mi = fs.readFileSync('/proc/meminfo', 'utf-8')
    swapTotal = Number(mi.match(/SwapTotal:\s+(\d+) kB/)?.[1] || 0) * 1024
    swapFree = Number(mi.match(/SwapFree:\s+(\d+) kB/)?.[1] || 0) * 1024
  } catch { /* */ }
  const dfLine = sh('df -B1 --output=size,used,avail / | tail -1').trim().split(/\s+/)
  let pm2: { name: string; status: string; cpu: number; memMB: number; restarts: number; uptimeMin: number; port?: number; url?: string }[] = []
  try {
    const { portByPid, portUrl } = getPortMaps()
    pm2 = JSON.parse(sh('pm2 jlist', 8000) || '[]').map((p: any) => {
      const ports = portByPid.get(p.pid) || []
      // ưu tiên port có URL public (nginx proxy) → link bấm mở được; không thì lấy port đầu
      const port = ports.find((x) => portUrl.has(x)) ?? ports[0]
      return {
        name: p.name, status: p.pm2_env?.status || '?',
        cpu: p.monit?.cpu ?? 0, memMB: Math.round((p.monit?.memory ?? 0) / 1048576),
        restarts: p.pm2_env?.restart_time ?? 0,
        uptimeMin: p.pm2_env?.pm_uptime ? Math.floor((Date.now() - p.pm2_env.pm_uptime) / 60000) : 0,
        port, url: port ? portUrl.get(port) : undefined,
      }
    })
  } catch { /* pm2 hỏng → mảng rỗng */ }
  res.json({
    load1: load[0], load5: load[1], load15: load[2], cores: os.cpus().length,
    memTotal: os.totalmem(), memAvail, swapTotal, swapUsed: swapTotal - swapFree,
    diskTotal: Number(dfLine[0] || 0), diskUsed: Number(dfLine[1] || 0), diskAvail: Number(dfLine[2] || 0),
    uptimeSec: os.uptime(), pm2,
  })
})

// ---- Cây tri thức: graph vault (folder→note→[[wiki-link]]) + graph tài nguyên VPS ----
type KNode = { id: string; label: string; kind: string; layer: number; meta?: string; val?: number; url?: string }
type KEdge = { source: string; target: string; rel: string; hier: boolean }
// vault 20k file (Daily/log sinh tự động) → chỉ walk các nhánh tri thức + cap để render-perf SVG
const KG_DIRS = ['Brain', 'Projects', 'Context', 'Reference', 'Skills', 'Reports']
const KG_MAX_NOTES_PER_DIR = 60   // folder quá rậm → gom node "+N ghi chú"
const KG_MAX_NODES = 900
let kgCache: { at: number; key: string; data: { nodes: KNode[]; edges: KEdge[] } } | null = null

function buildVaultGraph(withDaily: boolean): { nodes: KNode[]; edges: KEdge[] } {
  const nodes: KNode[] = []
  const edges: KEdge[] = []
  const noteByName = new Map<string, string>()   // basename/slug (lower) → node id
  const linkQueue: { from: string; raw: string }[] = []
  const dirs = withDaily ? [...KG_DIRS, 'Daily'] : KG_DIRS

  const addNote = (abs: string, parentId: string, layer: number) => {
    if (nodes.length >= KG_MAX_NODES) return
    const rel = path.relative(VAULT, abs)
    const base = path.basename(abs, '.md')
    const id = 'n:' + rel
    let kind = 'note', links: string[] = []
    try {
      const txt = fs.readFileSync(abs, 'utf-8').slice(0, 64 * 1024)
      const t = txt.match(/^\s*metadata:\s*\n\s*type:\s*(\w+)/m) || txt.match(/^\s*type:\s*(user|feedback|project|reference)\s*$/m)
      if (t) kind = 'note-' + t[1]
      links = [...txt.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim()).slice(0, 30)
    } catch { /* file hỏng → node trơ */ }
    nodes.push({ id, label: base, kind, layer, meta: rel })
    noteByName.set(base.toLowerCase(), id)
    edges.push({ source: parentId, target: id, rel: 'CONTAINS', hier: true })
    for (const raw of links) linkQueue.push({ from: id, raw })
  }

  const walk = (dir: string, parentId: string, depth: number) => {
    if (nodes.length >= KG_MAX_NODES) return
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    const folders = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    const notes = entries.filter((e) => e.isFile() && e.name.endsWith('.md'))
    const noteLayer = Math.min(depth + 1, 3)
    for (const n of notes.slice(0, KG_MAX_NOTES_PER_DIR)) addNote(path.join(dir, n.name), parentId, noteLayer)
    if (notes.length > KG_MAX_NOTES_PER_DIR) {
      const aggId = 'agg:' + path.relative(VAULT, dir)
      nodes.push({ id: aggId, label: `+${notes.length - KG_MAX_NOTES_PER_DIR} ghi chú`, kind: 'agg', layer: noteLayer })
      edges.push({ source: parentId, target: aggId, rel: 'CONTAINS', hier: true })
    }
    for (const f of folders) {
      const abs = path.join(dir, f.name)
      const id = 'd:' + path.relative(VAULT, abs)
      nodes.push({ id, label: f.name, kind: 'folder', layer: Math.min(depth + 1, 2) })
      edges.push({ source: parentId, target: id, rel: 'CONTAINS', hier: true })
      walk(abs, id, depth + 1)
    }
  }

  for (const d of dirs) {
    const abs = path.join(VAULT, d)
    if (!fs.existsSync(abs)) continue
    const id = 'd:' + d
    nodes.push({ id, label: d, kind: 'root', layer: 0 })
    walk(abs, id, 0)
  }
  // resolve [[wiki-link]] → edge chéo (đối chiếu basename không phân hoa thường)
  const seen = new Set<string>()
  for (const { from, raw } of linkQueue) {
    const to = noteByName.get(raw.toLowerCase())
    if (!to || to === from) continue
    const key = from + '→' + to
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({ source: from, target: to, rel: 'LINKS', hier: false })
  }
  return { nodes, edges }
}

function buildVpsGraph(): { nodes: KNode[]; edges: KEdge[] } {
  const nodes: KNode[] = []
  const edges: KEdge[] = []
  const add = (n: KNode) => { nodes.push(n); return n.id }
  const link = (source: string, target: string, rel: string, hier = true) => edges.push({ source, target, rel, hier })
  const gb = (n: number) => (n / 1073741824).toFixed(1) + 'G'
  const groups = { pm2: add({ id: 'g:pm2', label: 'PM2 services', kind: 'root', layer: 0 }),
    nginx: add({ id: 'g:nginx', label: 'Nginx sites', kind: 'root', layer: 0 }),
    cron: add({ id: 'g:cron', label: 'Cron', kind: 'root', layer: 0 }),
    sys: add({ id: 'g:sys', label: 'Hệ thống', kind: 'root', layer: 0 }) }

  // ss 1 lần: port→pid + port→tên process (owner) để gắn cổng mồ côi về sau
  const portByPid = new Map<number, number[]>()
  const portOwner = new Map<number, string>()
  for (const line of sh('ss -ltnp').split('\n').slice(1)) {
    const port = Number(line.match(/[\d.*\]]+:(\d+)\s/)?.[1] || 0)
    const pid = Number(line.match(/pid=(\d+)/)?.[1] || 0)
    const owner = line.match(/users:\(\("([^"]+)"/)?.[1] || ''
    if (!port) continue
    if (pid) portByPid.set(pid, [...(portByPid.get(pid) || []), port])
    if (owner && !portOwner.has(port)) portOwner.set(port, owner)
  }

  // pm2 procs (layer 1) + port đang nghe (layer 2, ghép qua pid)
  const portNode = new Map<number, string>()
  const ensurePort = (port: number, layer = 2) => {
    if (!portNode.has(port)) portNode.set(port, add({ id: 'port:' + port, label: ':' + port, kind: 'port', layer, meta: portOwner.get(port) }))
    return portNode.get(port)!
  }
  try {
    for (const p of JSON.parse(sh('pm2 jlist', 8000) || '[]')) {
      const id = add({ id: 'svc:' + p.name, label: p.name, kind: p.pm2_env?.status === 'online' ? 'svc' : 'svc-off', layer: 1, meta: `${p.pm2_env?.status} · ${Math.round((p.monit?.memory ?? 0) / 1048576)}MB` })
      link(groups.pm2, id, 'CONTAINS')
      for (const port of portByPid.get(p.pid) || []) {
        const isNew = !portNode.has(port)
        link(id, ensurePort(port), 'LISTENS', isNew)
      }
    }
  } catch { /* pm2 hỏng */ }

  // nginx: domain (server_name, layer 1) → location (layer 2) → proxy_pass port = cross-edge
  // portUrl: port → URL public (qua proxy_pass) để lan link bấm-mở-được sang node port/pm2
  const portUrl = new Map<number, string>()
  try {
    for (const f of fs.readdirSync('/etc/nginx/sites-enabled')) {
      let txt = ''
      try { txt = fs.readFileSync('/etc/nginx/sites-enabled/' + f, 'utf-8') } catch { continue }
      const domain = txt.match(/server_name\s+([^;]+);/)?.[1].trim().split(/\s+/)[0] || f
      const proto = /listen\s+[^;]*443/.test(txt) ? 'https' : 'http'
      const siteUrl = domain && domain !== '_' && domain.includes('.') ? `${proto}://${domain}` : undefined
      const siteId = add({ id: 'site:' + f, label: domain, kind: 'site', layer: 1, meta: f, url: siteUrl })
      link(groups.nginx, siteId, 'CONTAINS')
      const locs = [...txt.matchAll(/location\s+=?\s*([^\s{]+)\s*\{([^}]*)/g)]
      for (const [, loc, body] of locs.slice(0, 40)) {
        const routeUrl = siteUrl && loc.startsWith('/') ? siteUrl + (loc === '/' ? '' : loc) : undefined
        const id = add({ id: `ngx:${f}${loc}`, label: loc, kind: 'route', layer: 2, meta: domain, url: routeUrl })
        link(siteId, id, 'CONTAINS')
        const port = Number(body.match(/proxy_pass\s+https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/)?.[1] || 0)
        if (port) {
          link(id, ensurePort(port), 'PROXY', false)
          if (routeUrl && (loc === '/' || !portUrl.has(port))) portUrl.set(port, routeUrl)
        }
      }
    }
  } catch { /* không có nginx */ }

  // cron jobs (layer 1)
  sh('crontab -l').split('\n').filter((l) => l.trim() && !l.startsWith('#')).slice(0, 25).forEach((l, i) => {
    const name = (l.match(/([\w.-]+\.(?:sh|py|mjs|js))/)?.[1] || l.split(/\s+/).slice(5).join(' ').slice(0, 28)) || 'cron#' + i
    const id = add({ id: 'cron:' + i, label: name, kind: 'cron', layer: 1, meta: l.split(/\s+/).slice(0, 5).join(' ') })
    link(groups.cron, id, 'CONTAINS')
  })

  // ── Hệ thống chi tiết: CPU · RAM (top process) · Swap · Disk (top thư mục) · Cổng mở ──
  const load = os.loadavg()
  add({ id: 'sys:cpu', label: 'CPU', kind: 'res', layer: 1, meta: `${os.cpus().length} cores · load ${load[0].toFixed(2)}` })
  link(groups.sys, 'sys:cpu', 'CONTAINS')

  add({ id: 'sys:ram', label: 'RAM', kind: 'res', layer: 1, meta: `${gb(os.totalmem() - os.freemem())} / ${gb(os.totalmem())}` })
  link(groups.sys, 'sys:ram', 'CONTAINS')
  // top process theo RSS (dedupe theo tên, giữ max) → con của RAM
  const seenProc = new Set<string>()
  for (const line of sh('ps -eo rss,comm --sort=-rss').split('\n').slice(1, 14)) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/)
    if (!m) continue
    const name = m[2].trim()
    if (seenProc.has(name) || seenProc.size >= 7) continue
    seenProc.add(name)
    const id = add({ id: 'proc:' + name, label: name, kind: 'proc', layer: 2, meta: Math.round(Number(m[1]) / 1024) + 'MB RSS' })
    link('sys:ram', id, 'USES')
  }

  try {
    const mi = fs.readFileSync('/proc/meminfo', 'utf-8')
    const st = Number(mi.match(/SwapTotal:\s+(\d+) kB/)?.[1] || 0) * 1024
    const sf = Number(mi.match(/SwapFree:\s+(\d+) kB/)?.[1] || 0) * 1024
    if (st > 0) {
      add({ id: 'sys:swap', label: 'Swap', kind: 'res', layer: 1, meta: `${gb(st - sf)} / ${gb(st)}` })
      link(groups.sys, 'sys:swap', 'CONTAINS')
    }
  } catch { /* */ }

  const df = sh('df -B1 --output=size,used / | tail -1').trim().split(/\s+/)
  add({ id: 'sys:disk', label: 'Disk /', kind: 'res', layer: 1, meta: `${gb(Number(df[1] || 0))} / ${gb(Number(df[0] || 0))}` })
  link(groups.sys, 'sys:disk', 'CONTAINS')
  // top thư mục chiếm chỗ trong /root (du chậm ~vài giây → được cache 5 phút phía handler)
  for (const line of sh('du -xB1 --max-depth=1 /root 2>/dev/null | sort -rn | head -10', 15000).split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/)
    if (!m || m[2] === '/root') continue
    const name = path.basename(m[2])
    const id = add({ id: 'dir:' + m[2], label: name, kind: 'dir', layer: 2, meta: gb(Number(m[1])) })
    link('sys:disk', id, 'CONTAINS')
  }

  // cổng đang nghe chưa gắn vào pm2/nginx (mồ côi) → gom dưới "Cổng mở"
  const orphans = [...portOwner.keys()].filter((p) => !portNode.has(p)).slice(0, 15)
  if (orphans.length) {
    add({ id: 'sys:ports', label: 'Cổng mở', kind: 'res', layer: 1, meta: orphans.length + ' port' })
    link(groups.sys, 'sys:ports', 'CONTAINS')
    for (const p of orphans) link('sys:ports', ensurePort(p), 'LISTENS')
  }

  // ── Systemd services đang chạy (lọc noise hệ thống) ──
  const sysdSkip = /^(systemd-|dbus|getty|polkit|cron\.|rsyslog|multipath|udisks|unattended|packagekit|snapd|networkd|accounts)/
  const sysd = sh('systemctl list-units --type=service --state=running --no-legend --plain')
    .split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((n) => n?.endsWith('.service') && !sysdSkip.test(n)).slice(0, 15)
  if (sysd.length) {
    const gid = add({ id: 'g:sysd', label: 'Systemd', kind: 'root', layer: 0 })
    for (const s of sysd) {
      const name = s.replace(/\.service$/, '')
      const id = add({ id: 'sysd:' + name, label: name, kind: 'sysd', layer: 1, meta: 'running' })
      link(gid, id, 'CONTAINS')
      // nginx.service ↔ nhóm Nginx: nối chéo cho thấy quan hệ
      if (name === 'nginx') link(id, groups.nginx, 'RUNS', false)
    }
  }

  // ── Docker containers (nếu máy có docker) ──
  const docker = sh('docker ps --format "{{.Names}}|{{.Status}}"', 6000).split('\n').filter(Boolean).slice(0, 20)
  if (docker.length) {
    const gid = add({ id: 'g:docker', label: 'Docker', kind: 'root', layer: 0 })
    for (const line of docker) {
      const [name, status] = line.split('|')
      const id = add({ id: 'ctr:' + name, label: name, kind: 'ctr', layer: 1, meta: status })
      link(gid, id, 'CONTAINS')
    }
  }

  // gắn URL bấm được cho node port (theo proxy_pass) + lan sang pm2 svc đang LISTENS port đó
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  for (const n of nodes) {
    if (n.kind === 'port' && !n.url) { const u = portUrl.get(Number(n.id.slice(5))); if (u) n.url = u }
  }
  for (const e of edges) {
    if (e.rel !== 'LISTENS' || !e.source.startsWith('svc:')) continue
    const u = portUrl.get(Number(e.target.slice(5)))
    const sn = nodeById.get(e.source)
    if (u && sn && !sn.url) sn.url = u
  }

  return { nodes, edges }
}

// ---- Mode "code": knowledge graph gitnexus (3 repo Lucy) lên UI ----
// gitnexus CLI chậm (mở kuzu ~27MB mỗi lần) → build NỀN (execFile async, không block event loop),
// cache theo indexedAt của meta.json từng repo (chỉ rebuild khi index đổi) + đổ file /tmp.
const CODE_REPOS = [
  { name: 'L.U.C.Y', path: '/root/lucy/agent-machine', label: 'agent-machine' },
  { name: 'lucy-bridge', path: '/root/lucy/bridge', label: 'bridge' },
  { name: 'lucy-hub', path: '/root/lucy/hub', label: 'hub' },
]
const CODE_CACHE_FILE = '/tmp/lucy-hub-kgraph-code.json'
let codeCache: { key: string; data: { nodes: KNode[]; edges: KEdge[] } } | null = null
let codeBuilding = false

// key = ghép indexedAt 3 repo → index đổi thì key đổi → rebuild
function codeKey(): string {
  return CODE_REPOS.map((r) => {
    try { return JSON.parse(fs.readFileSync(path.join(r.path, '.gitnexus', 'meta.json'), 'utf-8')).indexedAt || '?' } catch { return '?' }
  }).join('|')
}

// parse bảng markdown gitnexus ("| a | b |\n| --- |\n| v1 | v2 |") → mảng object
function parseMdTable(md: string): Record<string, string>[] {
  const lines = md.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const cols = lines[0].replace(/^\||\|$/g, '').split('|').map((s) => s.trim())
  const rows: Record<string, string>[] = []
  for (let i = 2; i < lines.length; i++) {   // bỏ header (0) + separator (1)
    const cells = lines[i].replace(/^\||\|$/g, '').split('|').map((s) => s.trim())
    const row: Record<string, string> = {}
    cols.forEach((c, j) => { row[c] = cells[j] ?? '' })
    rows.push(row)
  }
  return rows
}
// execFile (KHÔNG shell → khỏi lo quote) → JSON stdout → parse bảng. Lỗ/lock → [] + retry 1 lần.
function gnCypher(repo: string, cy: string): Promise<Record<string, string>[]> {
  return new Promise((resolve) => {
    _execFile('gitnexus', ['cypher', '-r', repo, cy], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([])
      try { const j = JSON.parse(String(stdout)); if (j.error) return resolve([]); resolve(parseMdTable(j.markdown || '')) } catch { resolve([]) }
    })
  })
}
async function gnCypherRetry(repo: string, cy: string): Promise<Record<string, string>[]> {
  let r = await gnCypher(repo, cy)
  if (r.length === 0) { await new Promise((res) => setTimeout(res, 1500)); r = await gnCypher(repo, cy) }   // reindex lock → đợi rồi thử lại
  return r
}
const symKind = (label: string) => label === 'Class' ? 'cls' : label === 'Method' ? 'meth' : label === 'Interface' ? 'iface' : 'fn'

async function buildCodeGraph(): Promise<{ nodes: KNode[]; edges: KEdge[] }> {
  const nodes: KNode[] = []
  const edges: KEdge[] = []
  const ids = new Set<string>()
  for (const repo of CODE_REPOS) {
    const repoId = 'repo:' + repo.name
    nodes.push({ id: repoId, label: repo.label, kind: 'repo', layer: 0, meta: repo.path }); ids.add(repoId)
    // chuỗi folder repo→folder→…→file (folder tầng min(1+depth,2), file tầng 3)
    const ensureFile = (relFile: string): string => {
      const parts = relFile.split('/')
      parts.pop()
      let parentId = repoId, acc = ''
      parts.forEach((seg, i) => {
        acc = acc ? acc + '/' + seg : seg
        const id = repo.name + ':d:' + acc
        if (!ids.has(id)) { nodes.push({ id, label: seg, kind: 'cdir', layer: Math.min(1 + i, 2), meta: acc }); ids.add(id); edges.push({ source: parentId, target: id, rel: 'CONTAINS', hier: true }) }
        parentId = id
      })
      const fid = repo.name + ':f:' + relFile
      if (!ids.has(fid)) { nodes.push({ id: fid, label: path.basename(relFile), kind: 'cfile', layer: 3, meta: relFile }); ids.add(fid); edges.push({ source: parentId, target: fid, rel: 'CONTAINS', hier: true }) }
      return fid
    }
    // symbol lớn nhất (nhiều quan hệ nhất) → cap 130/repo cho UI mượt
    const syms = await gnCypherRetry(repo.name, "MATCH (fl:File)-[:CodeRelation {type:'DEFINES'}]->(s) WHERE label(s) IN ['Function','Class','Method','Interface'] MATCH (s)-[rr:CodeRelation]-() RETURN fl.filePath AS file, s.name AS name, label(s) AS kind, count(rr) AS deg ORDER BY deg DESC LIMIT 130")
    for (const r of syms) {
      const file = r.file, name = r.name
      if (!file || !name) continue
      const fileId = ensureFile(file)
      const sid = repo.name + ':s:' + file + '#' + name
      if (ids.has(sid)) continue
      nodes.push({ id: sid, label: name, kind: symKind(r.kind), layer: 4, meta: `${r.kind} · ${file}` }); ids.add(sid)
      edges.push({ source: fileId, target: sid, rel: 'DEFINES', hier: true })
    }
    // IMPORTS file→file (chéo) — chỉ vẽ khi cả 2 file đã có node
    for (const r of await gnCypherRetry(repo.name, "MATCH (a:File)-[:CodeRelation {type:'IMPORTS'}]->(b:File) RETURN a.filePath AS a, b.filePath AS b LIMIT 200")) {
      const A = repo.name + ':f:' + r.a, B = repo.name + ':f:' + r.b
      if (A !== B && ids.has(A) && ids.has(B)) edges.push({ source: A, target: B, rel: 'IMPORTS', hier: false })
    }
    // CALLS symbol→symbol (chéo, ưu tiên confidence cao ≥0.8) — chỉ vẽ khi cả 2 symbol đã có node
    for (const r of await gnCypherRetry(repo.name, "MATCH (sf:File)-[:CodeRelation {type:'DEFINES'}]->(a)-[r:CodeRelation {type:'CALLS'}]->(b)<-[:CodeRelation {type:'DEFINES'}]-(tf:File) WHERE r.confidence >= 0.8 RETURN sf.filePath AS sf, a.name AS a, tf.filePath AS tf, b.name AS b LIMIT 200")) {
      const A = repo.name + ':s:' + r.sf + '#' + r.a, B = repo.name + ':s:' + r.tf + '#' + r.b
      if (A !== B && ids.has(A) && ids.has(B)) edges.push({ source: A, target: B, rel: 'CALLS', hier: false })
    }
  }
  return { nodes, edges }
}
function buildCodeGraphAsync(key: string) {
  if (codeBuilding) return
  codeBuilding = true
  logEvent('info', 'kgraph', 'code graph: bắt đầu build nền (gitnexus)…')
  buildCodeGraph().then((data) => {
    codeCache = { key, data }
    try { fs.writeFileSync(CODE_CACHE_FILE, JSON.stringify(codeCache)) } catch { /* */ }
    logEvent('info', 'kgraph', `code graph xong: ${data.nodes.length} node · ${data.edges.length} liên kết`)
  }).catch((e) => logEvent('warn', 'kgraph', 'code build lỗi: ' + e)).finally(() => { codeBuilding = false })
}

// ---- Mode "files": cây thư mục toàn VPS (walk /root/lucy + /var/www, sâu ≤4) ----
const FILES_ROOTS = ['/root/lucy', '/var/www'].filter((p) => { try { return fs.existsSync(p) } catch { return false } })
const FILES_SKIP = new Set(['node_modules', '.git', '.gitnexus', 'dist', '__pycache__', 'venv', '.venv', 'cache', '.cache'])
const FILES_MAX_NODES = 800
const FILES_MAX_DEPTH = 4
let filesCache: { at: number; data: { nodes: KNode[]; edges: KEdge[] } } | null = null
function buildFilesGraph(): { nodes: KNode[]; edges: KEdge[] } {
  const nodes: KNode[] = []
  const edges: KEdge[] = []
  let count = 0
  const walk = (dir: string, parentId: string | null, depth: number) => {
    if (count >= FILES_MAX_NODES || depth > FILES_MAX_DEPTH) return
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    const files = entries.filter((e) => e.isFile())
    // size dir = tổng size file TRỰC TIẾP (nhanh, không du -s toàn cây)
    let size = 0
    for (const f of files) { try { size += fs.statSync(path.join(dir, f.name)).size } catch { /* */ } }
    const id = 'f:' + dir
    nodes.push({ id, label: path.basename(dir) || dir, kind: depth === 0 ? 'froot' : 'fdir', layer: Math.min(depth, FILES_MAX_DEPTH), meta: dir, val: size })
    count++
    if (parentId) edges.push({ source: parentId, target: id, rel: 'CONTAINS', hier: true })
    // đệ quy thư mục con (bỏ node_modules/.git/… và dotdir)
    if (depth < FILES_MAX_DEPTH) {
      for (const s of entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !FILES_SKIP.has(e.name))) {
        if (count >= FILES_MAX_NODES) break
        walk(path.join(dir, s.name), id, depth + 1)
      }
    }
    // file lá CHỈ hiện khi thư mục có <50 entry (đỡ rối)
    if (entries.length < 50) {
      for (const f of files) {
        if (count >= FILES_MAX_NODES) break
        let fsz = 0
        try { fsz = fs.statSync(path.join(dir, f.name)).size } catch { /* */ }
        const fid = 'f:' + path.join(dir, f.name)
        nodes.push({ id: fid, label: f.name, kind: 'ffile', layer: Math.min(depth + 1, FILES_MAX_DEPTH + 1), meta: path.join(dir, f.name), val: fsz })
        count++
        edges.push({ source: id, target: fid, rel: 'CONTAINS', hier: true })
      }
    }
  }
  for (const root of FILES_ROOTS) { if (count >= FILES_MAX_NODES) break; walk(root, null, 0) }
  return { nodes, edges }
}

app.get('/api/kgraph', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const src = ['vps', 'code', 'files'].includes(String(req.query.src)) ? String(req.query.src) : 'vault'
  // mode code: cache theo indexedAt, build nền. Có cache đúng key → trả; cache cũ → trả tạm + rebuild; chưa có → 202 building.
  if (src === 'code') {
    const wantKey = codeKey()
    if (!codeCache) { try { const j = JSON.parse(fs.readFileSync(CODE_CACHE_FILE, 'utf-8')); if (j?.key && j?.data) codeCache = j } catch { /* */ } }
    if (codeCache && codeCache.key === wantKey) return res.json(codeCache.data)
    buildCodeGraphAsync(wantKey)
    if (codeCache) return res.json({ ...codeCache.data, stale: true })   // index đổi → trả bản cũ, rebuild nền
    return res.status(202).json({ building: true, nodes: [], edges: [] })   // lần đầu → chờ build (~1 phút), FE poll lại
  }
  if (src === 'files') {
    if (filesCache && Date.now() - filesCache.at < 300_000) return res.json(filesCache.data)   // cache 5 phút
    const data = buildFilesGraph()
    filesCache = { at: Date.now(), data }
    return res.json(data)
  }
  const daily = req.query.daily === '1'
  const key = src + (daily ? '+daily' : '')
  // vault walk đọc ~700 file → cache 120s; vps có du /root (chậm vài giây) → cache 300s
  const ttl = src === 'vps' ? 300_000 : 120_000
  if (kgCache && kgCache.key === key && Date.now() - kgCache.at < ttl) return res.json(kgCache.data)
  const data = src === 'vps' ? buildVpsGraph() : buildVaultGraph(daily)
  kgCache = { at: Date.now(), key, data }
  res.json(data)
})

// ---- Memory rác: quét note rỗng/trùng/conflict trong vault → dọn = MOVE vào .trash (không xoá thật) ----
const MEM_SKIP = new Set(['.git', '.obsidian', '.trash', 'node_modules'])
function scanMemoryJunk(): { path: string; size: number; reason: string }[] {
  const out: { path: string; size: number; reason: string }[] = []
  const hashes = new Map<string, string>()   // md5 nội dung → file đầu tiên (giữ), file sau = trùng
  let scanned = 0
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= 400 || scanned > 25_000) return   // cap: vault 20k file, đủ dùng cho 1 lần dọn
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) { if (!MEM_SKIP.has(e.name) && !e.name.startsWith('.')) walk(abs); continue }
      if (!e.name.endsWith('.md')) continue
      scanned++
      const rel = path.relative(VAULT, abs)
      let st: fs.Stats
      try { st = fs.statSync(abs) } catch { continue }
      if (/sync-conflict|conflicted copy|\.orig\.md$/i.test(e.name)) { out.push({ path: rel, size: st.size, reason: 'file conflict' }); continue }
      if (st.size === 0) { out.push({ path: rel, size: 0, reason: 'rỗng' }); continue }
      if (st.size >= 512 * 1024) continue   // file to: không đọc (perf), cũng không phải "rác"
      let txt = ''
      try { txt = fs.readFileSync(abs, 'utf-8') } catch { continue }
      const body = txt.replace(/^---[\s\S]*?\n---\n?/, '').trim()   // bỏ frontmatter rồi mới xét rỗng
      if (body.length < 10) { out.push({ path: rel, size: st.size, reason: 'trống (chỉ frontmatter)' }); continue }
      const h = createHash('md5').update(txt).digest('hex')
      const first = hashes.get(h)
      if (first) out.push({ path: rel, size: st.size, reason: 'trùng với ' + first })
      else hashes.set(h, rel)
    }
  }
  walk(VAULT)
  return out
}
app.get('/api/memory/junk', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const items = scanMemoryJunk()
  res.json({ items, total: items.length, bytes: items.reduce((s, i) => s + i.size, 0) })
})
app.post('/api/memory/clean', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const paths: string[] = Array.isArray(req.body?.paths) ? req.body.paths.slice(0, 400).map(String) : []
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const trashRoot = path.join(VAULT, '.trash', stamp)
  let moved = 0
  const errors: string[] = []
  for (const rel of paths) {
    const abs = path.resolve(VAULT, rel)
    if (!abs.startsWith(VAULT + path.sep) || rel.includes('..')) { errors.push(rel + ': ngoài vault'); continue }   // chặn traversal
    try {
      const dest = path.join(trashRoot, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.renameSync(abs, dest)
      moved++
    } catch (err) { errors.push(rel + ': ' + String(err).slice(0, 80)) }
  }
  kgCache = null   // graph vault đổi → invalidate cache
  res.json({ moved, trash: '.trash/' + stamp, errors })
})

// ---- Nút dọn máy: bấm → agent (runClaude) tự chạy theo prompt allowlisted → poll /api/poll/:id ----
// An toàn: mỗi tool = prompt đóng khung lệnh được phép + danh sách CẤM (vault/source/DB). 1 job dọn/lúc.
const CLEAN_FORBID = `TUYỆT ĐỐI KHÔNG đụng: /root/lucy/lucy-vault, mã nguồn /root/lucy (trừ file .log), database (*.db, *.sqlite), /etc, pm2 process đang chạy (không stop/restart), file .env/credentials. Không dùng rm -rf trên thư mục gốc nào. Chỉ chạy đúng các lệnh được liệt kê.`
const CLEAN_TOOLS: Record<string, { label: string; prompt: string }> = {
  'pm2-logs': {
    label: 'Dọn log pm2 + journal',
    prompt: `Dọn log hệ thống VPS. Được phép chạy: \`du -sh /root/.pm2/logs\`, \`pm2 flush\`, \`journalctl --vacuum-size=100M\`, \`find /root/lucy -maxdepth 2 -name '*.log' -size +50M\` (chỉ LIỆT KÊ file log to, hỏi lại chứ không xoá). ${CLEAN_FORBID} Báo cáo ngắn: dung lượng trước/sau, đã làm gì.`,
  },
  caches: {
    label: 'Dọn cache (apt/npm/pip)',
    prompt: `Dọn cache VPS. Được phép chạy: \`du -sh /var/cache/apt /root/.npm /root/.cache/pip 2>/dev/null\`, \`apt-get clean\`, \`npm cache clean --force\`, \`pip cache purge\`. ${CLEAN_FORBID} Báo cáo ngắn: giải phóng được bao nhiêu.`,
  },
  tmp: {
    label: 'Dọn /tmp cũ',
    prompt: `Dọn file tạm VPS. Được phép: \`du -sh /tmp\`, xoá file/thư mục trong /tmp KHÔNG truy cập >7 ngày bằng \`find /tmp -mindepth 1 -atime +7 -delete\` (bỏ qua lỗi file đang dùng). ${CLEAN_FORBID} Báo cáo trước/sau.`,
  },
  analyze: {
    label: 'Phân tích disk (không xoá)',
    prompt: `CHỈ PHÂN TÍCH, KHÔNG XOÁ GÌ. Chạy \`df -h /\` và \`du -xh --max-depth=2 /root 2>/dev/null | sort -rh | head -25\` và \`du -xh --max-depth=1 /var 2>/dev/null | sort -rh | head -10\`. Tổng hợp: top thứ chiếm chỗ + đề xuất dọn gì (đánh dấu cái nào an toàn/cần chủ nhân duyệt). ${CLEAN_FORBID}`,
  },
}
let cleanRunning: string | null = null   // job_id đang dọn (1 lúc 1 job cho an toàn)

app.get('/api/vps/tools', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const runningJob = cleanRunning && jobs.get(cleanRunning)?.status === 'running' ? cleanRunning : null
  if (!runningJob) cleanRunning = null
  res.json({ tools: Object.entries(CLEAN_TOOLS).map(([id, t]) => ({ id, label: t.label })), running: runningJob })
})

app.post('/api/vps/clean', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauth' })
  const tool = CLEAN_TOOLS[String(req.body?.tool || '')]
  if (!tool) return res.status(400).json({ error: 'tool không tồn tại' })
  if (cleanRunning && jobs.get(cleanRunning)?.status === 'running') return res.status(409).json({ error: 'đang có job dọn chạy', job_id: cleanRunning })
  const id = randomBytes(8).toString('base64url')
  jobs.set(id, { status: 'running', result: null, model: 'sonnet', t0: Date.now(), session_id: null, prompt: '🧹 ' + tool.label })
  cleanRunning = id
  logEvent('info', 'vps', `🧹 dọn máy: ${tool.label}`)
  runClaude(tool.prompt, null, 'sonnet').then(({ text }) => {
    const j = jobs.get(id)
    if (j) { j.result = text; j.status = 'done' }
    if (cleanRunning === id) cleanRunning = null
    logEvent('info', 'vps', `✓ dọn xong: ${tool.label}`)
  })
  res.json({ job_id: id })
})

// serve React build (đặt CUỐI để /api ưu tiên)
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')))
}

app.listen(PORT, HOST, () => {
  if (!PASSWORD) console.log('⚠️  CHƯA đặt LUCY_HUB_PASSWORD — không đăng nhập được. Đặt env!')
  console.log(`Lucy Hub: http://${HOST}:${PORT}`)
})
