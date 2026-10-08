// mcp-registry.ts — M2 "TAY": khai báo MCP server + dựng cấu hình mcpServers cho SDK query() per-persona.
// Triết lý: KHÔNG nhồi hết tool vào mọi agent (vỡ cache/token). Mount per-persona theo SCOPE + creds + flag.
// An toàn (đêm tự động): master flag LUCY_MCP MẶC ĐỊNH TẮT → mcpConfigFor() trả {} → runner chạy y HỆT cũ.
// Server cần creds (GitHub/Google/Notion) → status='scaffold', chỉ bật khi đủ env (T5). Tool ghi/xoá nguy hiểm → KHÔNG expose ở đây.
import { execFile } from 'node:child_process'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { webFetch, webSearch } from './web-tools'
import { binanceTicker24h, binanceKlines } from './market-tools'
import { googleServer, googleConfigured } from './google-mcp'
import { openRecallFromEnv, episodicFlagOn } from './recall'
import { registryMcpServer, REGISTRY_MCP_DEFAULT_TOOLSETS } from './tools/registry-mcp'
import type { Persona } from './types'

// SDK chấp nhận record server config — giữ lỏng kiểu (stdio | sdk in-process) để khỏi phụ thuộc internal type.
export type McpServerConfig = Record<string, unknown>
export type McpScope = 'fs' | 'web' | 'git' | 'memory' | 'github' | 'google' | 'notion'

// Bối cảnh dựng server cho 1 run (workspace cô lập + repo + vault bền).
export interface McpCtx {
  workspace: string
  repoRoot?: string
  vault?: string
}

export interface McpSpec {
  id: string                       // = tên server (prefix tool: mcp__<id>__<tool>)
  title: string
  scopes: McpScope[]
  status: 'live' | 'scaffold'      // live = no-auth chạy được; scaffold = chờ creds (T5)
  envKeys?: string[]               // env BẮT BUỘC (creds) — thiếu → loại + nêu lý do
  doc?: string                     // hướng dẫn bật (cho UI Kết nối / handoff)
  scopeLabel?: string              // mô tả persona-scope cho UI (mặc định suy từ allow)
  allow?: (p: Persona) => boolean  // persona nào được mount (mặc định: tất cả)
  build: (ctx: McpCtx) => McpServerConfig | null  // null = không dựng được trong ctx này
}

// ─────────────────────────── helper dựng SDK in-process server ───────────────────────────
const T = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })

// đọc 1 lệnh git read-only trong repo → text (cap). KHÔNG commit/push (giữ an toàn — phá hủy lớn là việc chủ nhân).
function git(cwd: string, args: string[], cap = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return resolve('ERROR git: ' + String(stderr || err.message).slice(0, 300))
      const out = (stdout || '').slice(0, cap)
      resolve(out + ((stdout || '').length > cap ? '\n…(cắt bớt)' : '') || '(trống)')
    })
  })
}

function webServer(): McpServerConfig {
  return createSdkMcpServer({
    name: 'web', version: '1.0.0',
    tools: [
      tool('web_fetch', 'Lấy nội dung 1 URL (http/https) → text đã strip HTML. SSRF-guarded (chặn host nội bộ).',
        { url: z.string().describe('URL http/https cần đọc') },
        async (a) => T(await webFetch(String(a.url)))),
      tool('web_search', 'Tìm web no-key (DuckDuckGo) → top kết quả {title,url}. Dùng để tìm nguồn rồi web_fetch.',
        { query: z.string().describe('truy vấn tìm kiếm'), n: z.number().optional().describe('số kết quả (mặc định 5)') },
        async (a) => T(await webSearch(String(a.query), a.n ? Number(a.n) : 5))),
    ],
  }) as unknown as McpServerConfig
}

function gitServer(repoRoot: string): McpServerConfig {
  return createSdkMcpServer({
    name: 'git', version: '1.0.0',
    tools: [
      tool('git_status', 'git status (porcelain) của repo hiện tại.', {},
        async () => T(await git(repoRoot, ['status', '--porcelain=v1', '-b']))),
      tool('git_diff', 'git diff. staged=true xem phần đã add. path để giới hạn 1 file/thư mục.',
        { staged: z.boolean().optional(), path: z.string().optional() },
        async (a) => T(await git(repoRoot, ['diff', ...(a.staged ? ['--staged'] : []), ...(a.path ? ['--', String(a.path)] : [])]))),
      tool('git_log', 'git log gần đây (oneline). n = số commit (mặc định 15).',
        { n: z.number().optional() },
        async (a) => T(await git(repoRoot, ['log', `-${a.n ? Math.min(100, Number(a.n)) : 15}`, '--oneline', '--no-color']))),
    ],
  }) as unknown as McpServerConfig
}

// M2.3 — basic-memory: expose recall (vault) + episodic (turn hội thoại) cho agent trong pipeline (nối M1).
function memoryServer(): McpServerConfig {
  return createSdkMcpServer({
    name: 'memory', version: '1.0.0',
    tools: [
      tool('memory_recall', 'Tra TRÍ NHỚ Lucy (vault: về chủ nhân + dự án + điều đã học). Trả các ghi chú khớp nhất.',
        { query: z.string().describe('điều cần nhớ lại'), limit: z.number().optional() },
        async (a) => {
          const r = openRecallFromEnv()
          if (!r) return T('(trí nhớ chưa cấu hình — LUCY_VAULT trống)')
          try {
            const hits = await r.hybridSearch(String(a.query), { limit: a.limit ? Math.min(20, Number(a.limit)) : 6 })
            if (!hits.length) return T('(không tìm thấy ghi chú khớp)')
            return T(hits.map((h, i) => `${i + 1}. [${h.type}] ${h.title}\n   ${h.snippet}`).join('\n'))
          } catch (e) { return T('ERROR memory_recall: ' + String((e as Error)?.message || e).slice(0, 200)) }
        }),
      tool('memory_episodic', 'Tra lịch sử HỘI THOẠI đã lưu (turn cũ giữa chủ nhân và Lucy).',
        { query: z.string(), limit: z.number().optional() },
        async (a) => {
          if (!episodicFlagOn()) return T('(episodic đang tắt)')
          const r = openRecallFromEnv()
          if (!r) return T('(trí nhớ chưa cấu hình)')
          try {
            const hits = r.searchTurns(String(a.query), { limit: a.limit ? Math.min(20, Number(a.limit)) : 6 })
            if (!hits.length) return T('(không có lượt hội thoại khớp)')
            return T(hits.map((h) => `[${h.source}/${h.role}] ${h.snippet}`).join('\n'))
          } catch (e) { return T('ERROR memory_episodic: ' + String((e as Error)?.message || e).slice(0, 200)) }
        }),
    ],
  }) as unknown as McpServerConfig
}

// X3 — Binance public REST (KEYLESS) gói thành in-process MCP server: giá + nến crypto. Read-only, host cố định.
function binanceServer(): McpServerConfig {
  return createSdkMcpServer({
    name: 'binance', version: '1.0.0',
    tools: [
      tool('binance_price', 'Giá HIỆN TẠI + thống kê 24h của 1 cặp Binance (vd BTCUSDT, ETHUSDT). KEYLESS, chỉ crypto.',
        { symbol: z.string().describe('cặp giao dịch, vd BTCUSDT') },
        async (a) => T(await binanceTicker24h(String(a.symbol)))),
      tool('binance_klines', 'Nến OHLCV Binance. interval 1m/5m/15m/1h/4h/1d/1w… limit ≤200. KEYLESS, chỉ crypto.',
        { symbol: z.string().describe('vd BTCUSDT'), interval: z.string().optional().describe('mặc định 1h'), limit: z.number().optional().describe('số nến, mặc định 50') },
        async (a) => T(await binanceKlines(String(a.symbol), a.interval ? String(a.interval) : '1h', a.limit ? Number(a.limit) : 50))),
    ],
  }) as unknown as McpServerConfig
}

// ─────────────────────────── REGISTRY ───────────────────────────
// persona allow helpers: kind code → engineer/devops/reviewer/architect/tester/investigator/security/builder/grinder
const CODE_IDS = new Set(['engineer', 'devops', 'reviewer', 'architect', 'tester', 'investigator', 'security', 'builder', 'grinder'])
const isCode = (p: Persona) => CODE_IDS.has(p.id) || p.kind === 'executor'
// X3 — server thị trường mount cho persona tài chính/nghiên cứu (finance/analyst/marketing/researcher).
const FINANCE_IDS = new Set(['finance', 'analyst', 'marketing', 'researcher'])
const isFinance = (p: Persona) => FINANCE_IDS.has(p.id) || /finance|market|tài chính|invest/i.test(p.name || '')

export const MCP_REGISTRY: McpSpec[] = [
  {
    id: 'fs', title: 'Filesystem (workspace)', scopes: ['fs'], status: 'live',
    doc: 'Đọc/ghi file trong workspace của card (qua @modelcontextprotocol/server-filesystem, npx tự kéo). Scope = workspace + repo.',
    build: (ctx) => {
      const dirs = [ctx.workspace, ctx.repoRoot].filter((d): d is string => !!d)
      if (!dirs.length) return null
      return { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', ...dirs] }
    },
  },
  {
    id: 'web', title: 'Web (fetch + search)', scopes: ['web'], status: 'live',
    doc: 'web_fetch (URL→text) + web_search (DuckDuckGo no-key). In-process, SSRF-guarded.',
    build: () => webServer(),
  },
  {
    id: 'git', title: 'Git (read-only)', scopes: ['git'], status: 'live',
    doc: 'git status/diff/log read-only. KHÔNG commit/push (an toàn). In-process.',
    allow: isCode,
    build: (ctx) => { const root = ctx.repoRoot || ctx.workspace; return root ? gitServer(root) : null },
  },
  {
    id: 'memory', title: 'Trí nhớ (vault + hội thoại)', scopes: ['memory'], status: 'live',
    doc: 'memory_recall (vault) + memory_episodic (turn hội thoại). Nối M1. Cần LUCY_VAULT.',
    build: () => (process.env.LUCY_VAULT ? memoryServer() : null),
  },
  // ─────────── CL-3 — Cầu Registry → MCP: tool khai báo 1 lần ở CL-2 registry, expose qua MCP in-process. ───────────
  // status='scaffold' (KHÔNG creds) → mặc định TẮT kể cả khi LUCY_MCP=1; bật thử nghiệm: LUCY_MCP=1 + LUCY_MCP_REGISTRY=on.
  // Trùng tool với server web/fs sẵn có là CỐ Ý (đây là đường thử adapter); chỉ bật khi muốn so/đổi sang registry path.
  {
    id: 'registry', title: 'Tool Registry (CL-2 → MCP)', scopes: ['web', 'fs'], status: 'scaffold',
    scopeLabel: 'mọi persona (thử nghiệm)',
    doc: 'Cầu CL-3: tool lane (web_search/web_fetch/read_file/list_dir/write_file/edit_file) khai báo 1 lần ở CL-2 registry, chạy qua MCP in-process — CÙNG handler. Mặc định TẮT. BẬT: LUCY_MCP=1 + LUCY_MCP_REGISTRY=on. fs bó trong workspace (mode runner).',
    build: (ctx) => registryMcpServer(REGISTRY_MCP_DEFAULT_TOOLSETS, { ws: ctx.workspace, mode: 'runner' }, { name: 'registry' }),
  },
  // ─────────── T5 — CONNECTORS cần creds (SCAFFOLD): chỉ mount khi đủ env + flag. Đêm tự động KHÔNG tự auth. ───────────
  {
    id: 'github', title: 'GitHub (repos/issues/PR)', scopes: ['github'], status: 'scaffold',
    envKeys: ['GITHUB_TOKEN'], scopeLabel: 'persona code',
    doc: 'GitHub MCP (@modelcontextprotocol/server-github qua npx). BẬT: đặt GITHUB_TOKEN (PAT, scope repo) trong env worker + LUCY_MCP=1, LUCY_MCP_GITHUB=on. Sáng chủ nhân: `gh auth login` hoặc tạo PAT → .env.llm.',
    allow: isCode,
    // npx tự kéo; SDK truyền GITHUB_PERSONAL_ACCESS_TOKEN cho server. Chỉ dựng khi có token (credsMissing đã gate trước).
    build: () => {
      const tok = process.env.GITHUB_TOKEN
      if (!tok) return null
      return { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: tok } }
    },
  },
  {
    id: 'google', title: 'Google Workspace (Gmail/Calendar/Drive/YouTube)', scopes: ['google'], status: 'live',
    envKeys: ['GOOGLE_REFRESH_TOKEN'], scopeLabel: 'mọi persona',
    doc: 'Google READONLY in-process (G1): gmail_search/gmail_read · calendar_upcoming · drive_search · youtube_my_channel/youtube_search. OAuth refresh từ GOOGLE_REFRESH_TOKEN + client (.gcp-oauth.json) — tự refresh access_token, KHÔNG echo token. BẬT: LUCY_MCP=1 + LUCY_MCP_GOOGLE=on + GOOGLE_REFRESH_TOKEN trong .env.llm.',
    // status live nhưng envKeys gate: thiếu GOOGLE_REFRESH_TOKEN → credsMissing loại trước. Thêm backstop googleConfigured() (cần cả client file).
    build: () => (googleConfigured() ? (googleServer() as McpServerConfig) : null),
  },
  {
    id: 'notion', title: 'Notion (pages/databases)', scopes: ['notion'], status: 'scaffold',
    envKeys: ['NOTION_TOKEN'], scopeLabel: 'mọi persona',
    doc: 'Notion MCP (@notionhq/notion-mcp-server qua npx). BẬT: tạo internal integration → NOTION_TOKEN (secret) trong env worker + LUCY_MCP=1, LUCY_MCP_NOTION=on, share page/db cho integration.',
    build: () => {
      const tok = process.env.NOTION_TOKEN
      if (!tok) return null
      // notion-mcp-server đọc header Authorization qua OPENAPI_MCP_HEADERS (JSON).
      const headers = JSON.stringify({ Authorization: `Bearer ${tok}`, 'Notion-Version': '2022-06-28' })
      return { type: 'stdio', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { OPENAPI_MCP_HEADERS: headers } }
    },
  },
  // ─────────── X3 — DATA THỊ TRƯỜNG (persona finance). CoinGecko+Binance KEYLESS bật sẵn; Twelve Data chờ key. ───────────
  {
    id: 'binance', title: 'Binance (giá/nến crypto)', scopes: ['web'], status: 'live',
    scopeLabel: 'persona finance', allow: isFinance,
    doc: 'Binance public REST KEYLESS (in-process): binance_price (giá+24h) + binance_klines (nến OHLCV). Read-only, CHỈ crypto. Bật sẵn khi LUCY_MCP=1; tắt qua LUCY_MCP_BINANCE=off. Đổi host qua BINANCE_REST_URL.',
    build: () => binanceServer(),
  },
  {
    id: 'coingecko', title: 'CoinGecko (crypto giá/market cap)', scopes: ['web'], status: 'live',
    scopeLabel: 'persona finance', allow: isFinance,
    doc: 'CoinGecko MCP hosted KEYLESS (mcp.api.coingecko.com/sse) — giá/market cap/lịch sử/coin metadata. Bật sẵn khi LUCY_MCP=1; tắt qua LUCY_MCP_COINGECKO=off. Đổi endpoint qua COINGECKO_MCP_URL.',
    build: () => ({ type: 'sse', url: process.env.COINGECKO_MCP_URL || 'https://mcp.api.coingecko.com/sse' }),
  },
  {
    id: 'twelvedata', title: 'Twelve Data (CK/forex/vàng XAU)', scopes: ['web'], status: 'scaffold',
    envKeys: ['TWELVEDATA_API_KEY'], scopeLabel: 'persona finance', allow: isFinance,
    doc: 'Twelve Data MCP (cổ phiếu/forex/XAU vàng/chỉ số — KHÔNG phải crypto). BẬT: lấy API key tại twelvedata.com → đặt TWELVEDATA_API_KEY trong .env.llm + LUCY_MCP=1, LUCY_MCP_TWELVEDATA=on. Endpoint đổi qua TWELVEDATA_MCP_URL (mặc định https://mcp.twelvedata.com/mcp).',
    build: () => {
      const key = process.env.TWELVEDATA_API_KEY
      if (!key) return null // scaffold: thiếu key → DOC-only (credsMissing đã gate trước, đây là backstop)
      const url = process.env.TWELVEDATA_MCP_URL || 'https://mcp.twelvedata.com/mcp'
      return { type: 'http', url, headers: { authorization: `apikey ${key}` } }
    },
  },
]

// ─────────────────────────── circuit-breaker (per-session, in-memory) ───────────────────────────
const FAIL_CAP = 3
const breaker = new Map<string, number>()  // id → số lần lỗi liên tiếp
export function mcpNoteFailure(id: string): void { breaker.set(id, (breaker.get(id) || 0) + 1) }
export function mcpNoteSuccess(id: string): void { breaker.delete(id) }
export function mcpTripped(id: string): boolean { return (breaker.get(id) || 0) >= FAIL_CAP }
export function mcpResetBreaker(): void { breaker.clear() }

// ─────────────────────────── gating ───────────────────────────
// master: LUCY_MCP phải bật ('1'/'true'/'on') — mặc định TẮT (live an toàn).
export function mcpMasterOn(): boolean {
  const f = (process.env.LUCY_MCP || '').toLowerCase()
  return f === '1' || f === 'true' || f === 'on'
}

// per-server: LUCY_MCP_<ID> đè; chưa set → mặc định = (status==='live').
function serverEnabled(spec: McpSpec): boolean {
  const raw = process.env[`LUCY_MCP_${spec.id.toUpperCase()}`]
  if (raw != null) { const f = raw.toLowerCase(); return f === '1' || f === 'true' || f === 'on' }
  return spec.status === 'live'
}

function credsMissing(spec: McpSpec): string[] {
  return (spec.envKeys || []).filter((k) => !process.env[k] || !String(process.env[k]).trim())
}

export type McpPlanItem = { id: string; title: string; scopes: McpScope[]; status: McpSpec['status']; included: boolean; reason: string }

// Lập KẾ HOẠCH mount cho 1 persona+ctx (chẩn đoán, cho UI/smoke). Sort theo id → prompt-cache ổn định.
export function mcpPlanFor(persona: Persona, ctx: McpCtx): McpPlanItem[] {
  const out: McpPlanItem[] = []
  for (const spec of [...MCP_REGISTRY].sort((a, b) => a.id.localeCompare(b.id))) {
    const base = { id: spec.id, title: spec.title, scopes: spec.scopes, status: spec.status }
    if (!mcpMasterOn()) { out.push({ ...base, included: false, reason: 'LUCY_MCP tắt' }); continue }
    if (!serverEnabled(spec)) { out.push({ ...base, included: false, reason: 'server tắt (flag)' }); continue }
    if (spec.allow && !spec.allow(persona)) { out.push({ ...base, included: false, reason: 'persona không thuộc scope' }); continue }
    const miss = credsMissing(spec)
    if (miss.length) { out.push({ ...base, included: false, reason: 'thiếu creds: ' + miss.join(', ') }); continue }
    if (mcpTripped(spec.id)) { out.push({ ...base, included: false, reason: 'circuit-breaker (lỗi nhiều lần)' }); continue }
    const cfg = spec.build(ctx)
    if (!cfg) { out.push({ ...base, included: false, reason: 'không dựng được trong ctx (thiếu path/vault)' }); continue }
    out.push({ ...base, included: true, reason: 'mount' })
  }
  return out
}

// Dựng mcpServers record cho SDK query(). Trả {} khi master tắt → runner chạy y hệt cũ.
export function mcpConfigFor(persona: Persona, ctx: McpCtx): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {}
  if (!mcpMasterOn()) return servers
  for (const spec of [...MCP_REGISTRY].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!serverEnabled(spec)) continue
    if (spec.allow && !spec.allow(persona)) continue
    if (credsMissing(spec).length) continue
    if (mcpTripped(spec.id)) continue
    const cfg = spec.build(ctx)
    if (cfg) servers[spec.id] = cfg
  }
  return servers
}

// allowedTools cho phép tool MCP của các server đã mount (mc__<id>) — gộp vào allowedTools persona.
export function mcpAllowedTools(servers: Record<string, McpServerConfig>): string[] {
  return Object.keys(servers).sort().map((id) => `mcp__${id}`)
}

// ─────────────────────────── T5 — overview cho UI "Kết nối" (không gắn persona) ───────────────────────────
// UI hiển thị từng server: trạng thái tổng + hướng dẫn bật. KHÔNG đụng creds (chỉ báo có/thiếu).
export type McpUiState = 'master-off' | 'disabled' | 'needs-creds' | 'tripped' | 'live'
export interface McpOverviewItem {
  id: string; title: string; scopes: McpScope[]; status: McpSpec['status']
  doc: string; scopeLabel: string
  envKeys: string[]; credsMissing: string[]
  masterOn: boolean; serverEnabled: boolean; tripped: boolean
  state: McpUiState
}

export function mcpRegistryOverview(): { masterOn: boolean; servers: McpOverviewItem[] } {
  const masterOn = mcpMasterOn()
  const servers = [...MCP_REGISTRY].sort((a, b) => a.id.localeCompare(b.id)).map((spec): McpOverviewItem => {
    const enabled = serverEnabled(spec)
    const miss = credsMissing(spec)
    const tripped = mcpTripped(spec.id)
    // Ưu tiên creds trước flag: thiếu token là blocker actionable nhất cho UI (user biết phải cắm key).
    let state: McpUiState
    if (!masterOn) state = 'master-off'
    else if (miss.length) state = 'needs-creds'
    else if (!enabled) state = 'disabled'
    else if (tripped) state = 'tripped'
    else state = 'live'
    return {
      id: spec.id, title: spec.title, scopes: spec.scopes, status: spec.status,
      doc: spec.doc || '', scopeLabel: spec.scopeLabel || (spec.allow ? 'persona giới hạn' : 'mọi persona'),
      envKeys: spec.envKeys || [], credsMissing: miss,
      masterOn, serverEnabled: enabled, tripped, state,
    }
  })
  return { masterOn, servers }
}
