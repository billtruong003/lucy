// CL-2 — Gom tool lane HIỆN CÓ vào registry. VIẾT HANDLER 1 LẦN, expose cho cả lane-chat & lane-runner.
// Hành vi giữ NGUYÊN theo ctx.mode:
//   chat   → path tuyệt đối/tương đối + blacklist nhạy cảm, bash qua `bash -lc` (60s), cap đọc 20000 (như lane-chat.ts cũ).
//   runner → bó CHẶT trong workspace + gate theo persona.allowedTools, bash IS_SANDBOX=1 (120s), cap đọc 30000 (như lane-runner.ts cũ).
// web_* + binance_* dùng chung helper sẵn có (web-tools.ts / market-tools.ts) — không phụ thuộc mode.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { registry, type ToolCtx } from './registry'
import { webFetch, webSearch } from '../web-tools'
import { binanceTicker24h, binanceKlines } from '../market-tools'

const S = (a: Record<string, unknown>, k: string): string => { const v = a[k]; return typeof v === 'string' ? v : v == null ? '' : String(v) }

// ── sandbox path: 2 luật theo mode (copy nguyên từ lane-chat.ts + lane-runner.ts) ──
const SENSITIVE_PATTERNS = [/\/\.ssh\//, /\/\.gnupg\//, /[/.]env$/, /\.env\./, /private[_-]?key/i, /secret[_-]?key/i, /id_rsa/, /id_ed25519/, /credentials\.json/i]
function isSensitive(p: string): boolean { return SENSITIVE_PATTERNS.some((rx) => rx.test(p)) }

function resolveChat(ws: string, p: string): string {
  const r = path.isAbsolute(p) ? path.normalize(p) : path.resolve(ws, p || '.')
  if (isSensitive(r)) throw new Error(`path nhạy cảm bị chặn: ${r}`)
  return r
}
function resolveRunner(ws: string, p: string): string {
  const root = path.resolve(ws)
  const abs = path.resolve(ws, p)
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('đường dẫn ngoài workspace — bị chặn')
  return abs
}
function resolveFor(ctx: ToolCtx, p: string): string {
  return ctx.mode === 'runner' ? resolveRunner(ctx.ws, p) : resolveChat(ctx.ws, p)
}

// runner gate: tool → quyền claude-style; chặn khi persona không có quyền (giữ least-privilege lane-runner cũ).
const TOOL_PERM: Record<string, string> = { read_file: 'Read', list_dir: 'Read', write_file: 'Write', edit_file: 'Edit', bash: 'Bash' }
function permError(ctx: ToolCtx, name: string): string | null {
  if (ctx.mode !== 'runner') return null
  const need = TOOL_PERM[name]
  if (need && ctx.allowed && !ctx.allowed.has(need)) return `ERROR: persona không được phép tool "${name}" (${need})`
  return null
}

function bashChat(cmd: string, ws: string, timeoutMs = 60000): Promise<string> {
  return new Promise((resolve) => {
    const ch = spawn('bash', ['-lc', cmd], { cwd: ws, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const t = setTimeout(() => ch.kill(), timeoutMs)
    ch.stdout.on('data', (d) => (out += d)); ch.stderr.on('data', (d) => (out += d))
    ch.on('close', (code) => { clearTimeout(t); resolve((out || '').slice(0, 8000) + (code ? `\n[exit ${code}]` : '')) })
    ch.on('error', (e) => { clearTimeout(t); resolve('ERROR bash: ' + String(e).slice(0, 200)) })
  })
}
function bashRunner(cmd: string, ws: string): Promise<string> {
  return new Promise((resolve) => {
    const ch = spawn(cmd, { cwd: ws, shell: true, env: { ...process.env, IS_SANDBOX: '1' } })
    let out = ''
    const timer = setTimeout(() => ch.kill(), 120000)
    ch.stdout.on('data', (d) => (out += d)); ch.stderr.on('data', (d) => (out += d))
    ch.on('close', (code) => { clearTimeout(timer); resolve(((out || '(no output)').slice(0, 8000)) + (code ? `\n[exit ${code}]` : '')) })
    ch.on('error', (e) => { clearTimeout(timer); resolve(`ERROR spawn: ${e}`) })
  })
}

// ── handler dùng chung (1 lần) — file tool branch theo mode để GIỮ NGUYÊN chuỗi trả & cap cũ ──
async function readFile(a: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const gate = permError(ctx, 'read_file'); if (gate) return gate
  const p = resolveFor(ctx, S(a, 'path'))
  const c = fs.readFileSync(p, 'utf8')
  const cap = ctx.mode === 'runner' ? 30000 : 20000
  return c.length > cap ? c.slice(0, cap) + (ctx.mode === 'runner' ? '\n…(cắt bớt)' : '\n…(cắt)') : c
}
async function listDir(a: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const gate = permError(ctx, 'list_dir'); if (gate) return gate
  const d = resolveFor(ctx, S(a, 'path') || '.')
  return fs.readdirSync(d, { withFileTypes: true }).map((e) => e.isDirectory() ? e.name + '/' : e.name).join('\n') || '(rỗng)'
}
async function writeFile(a: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const gate = permError(ctx, 'write_file'); if (gate) return gate
  const rel = S(a, 'path')
  const p = resolveFor(ctx, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const content = S(a, 'content')
  fs.writeFileSync(p, content)
  return ctx.mode === 'runner' ? `đã ghi ${rel} (${content.length} ký tự)` : `đã ghi ${p}`
}
async function editFile(a: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const gate = permError(ctx, 'edit_file'); if (gate) return gate
  const rel = S(a, 'path')
  const p = resolveFor(ctx, rel)
  const cur = fs.readFileSync(p, 'utf8')
  const o = S(a, 'old_string')
  if (!cur.includes(o)) return `ERROR: không thấy old_string trong ${ctx.mode === 'runner' ? rel : p}`
  fs.writeFileSync(p, cur.replace(o, S(a, 'new_string')))
  return ctx.mode === 'runner' ? `đã sửa ${rel}` : `đã sửa ${p}`
}
async function bashTool(a: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const gate = permError(ctx, 'bash'); if (gate) return gate
  return ctx.mode === 'runner' ? bashRunner(S(a, 'cmd'), ctx.ws) : bashChat(S(a, 'cmd'), ctx.ws)
}

// ── đăng ký 1 lần (idempotent) ──
let done = false
export function registerLaneTools(): void {
  if (done) return
  done = true

  registry.register({ name: 'web_search', toolset: 'web', emoji: '🔎', description: 'Tìm web (DuckDuckGo) → top kết quả {tiêu đề, URL}. Dùng để research/tra thông tin mới.', schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, handler: (a) => webSearch(S(a, 'query')) })
  registry.register({ name: 'web_fetch', toolset: 'web', emoji: '🌐', description: 'Lấy nội dung 1 URL (text). Dùng sau web_search để đọc trang cụ thể.', schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, handler: (a) => webFetch(S(a, 'url')) })

  registry.register({ name: 'read_file', toolset: 'fs-rw', emoji: '📄', description: 'Đọc file (path tuyệt đối hoặc tương đối từ workspace).', schema: { type: 'object', properties: { path: { type: 'string', description: 'Path tuyệt đối (ví dụ /root/lucy/hub/server/src/index.ts) hoặc tương đối từ workspace' } }, required: ['path'] }, handler: readFile })
  registry.register({ name: 'list_dir', toolset: 'fs-rw', emoji: '📁', description: 'Liệt kê thư mục (path tuyệt đối hoặc tương đối).', schema: { type: 'object', properties: { path: { type: 'string', description: 'Path thư mục, mặc định = workspace' } } }, handler: listDir })
  registry.register({ name: 'write_file', toolset: 'fs-rw', emoji: '✍️', description: 'Ghi/tạo file (path tuyệt đối hoặc tương đối từ workspace).', schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }, handler: writeFile })
  registry.register({ name: 'edit_file', toolset: 'fs-rw', emoji: '✏️', description: 'Thay old_string → new_string trong file. Dùng khi chỉ cần sửa 1 đoạn nhỏ.', schema: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'] }, handler: editFile })

  registry.register({ name: 'bash', toolset: 'bash', emoji: '⚡', description: 'Chạy lệnh shell. KHÔNG git push, KHÔNG xoá hàng loạt, KHÔNG echo/cat secrets.', schema: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] }, handler: bashTool })

  registry.register({ name: 'binance_price', toolset: 'market', emoji: '📈', description: 'Giá HIỆN TẠI + thống kê 24h của 1 cặp Binance (vd BTCUSDT). KEYLESS, chỉ crypto.', schema: { type: 'object', properties: { symbol: { type: 'string', description: 'cặp giao dịch, vd BTCUSDT' } }, required: ['symbol'] }, handler: (a) => binanceTicker24h(S(a, 'symbol')) })
  registry.register({ name: 'binance_klines', toolset: 'market', emoji: '🕯️', description: 'Nến OHLCV Binance. interval 1m/5m/15m/1h/4h/1d/1w… limit ≤200. KEYLESS, chỉ crypto.', schema: { type: 'object', properties: { symbol: { type: 'string', description: 'vd BTCUSDT' }, interval: { type: 'string', description: 'mặc định 1h' }, limit: { type: 'number', description: 'số nến, mặc định 50' } }, required: ['symbol'] }, handler: (a) => binanceKlines(S(a, 'symbol'), a.interval ? S(a, 'interval') : '1h', a.limit ? Number(a.limit) : 50) })

  // toolset tổng hợp (composition lồng nhau). consult_expert đăng ký riêng ở lane-chat (tránh import vòng).
  // LƯU Ý: tên toolset KHÔNG được trùng tên tool ('bash' là tool → cycle guard sẽ cắt nếu đặt toolset cùng tên).
  registry.registerToolset('web', ['web_search', 'web_fetch'])
  registry.registerToolset('fs-rw', ['read_file', 'list_dir', 'write_file', 'edit_file'])
  registry.registerToolset('market', ['binance_price', 'binance_klines'])
  registry.registerToolset('lucy-runner', ['fs-rw', 'bash'])                 // 5 tool (gate theo allowedTools)
  registry.registerToolset('lucy-lane', ['web', 'fs-rw', 'bash'])            // 7 tool (chat — consult thêm rời)
}
