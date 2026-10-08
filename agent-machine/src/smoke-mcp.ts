// Smoke — M2 MCP registry (M2.1 framework + M2.2 core no-auth + M2.3 memory).
// KHÔNG spawn claude, KHÔNG mount thật, KHÔNG mạng. Chỉ kiểm tra LOGIC: gating, persona-scope, creds, circuit-breaker, sort ổn định.
import {
  mcpConfigFor, mcpPlanFor, mcpAllowedTools, MCP_REGISTRY,
  mcpNoteFailure, mcpResetBreaker, mcpMasterOn, mcpRegistryOverview,
} from './mcp-registry'
import type { Persona } from './types'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

const engineer: Persona = { id: 'engineer', name: 'Engineer', systemPrompt: 'code', model: 'sonnet', kind: 'specialist' }
const finance: Persona = { id: 'finance', name: 'Finance', systemPrompt: 'tiền', model: 'sonnet', kind: 'specialist' }
const ctx = { workspace: '/tmp/ws', repoRoot: '/tmp/ws', vault: '/tmp/vault' }

// đặt env sạch cho test có kiểm soát (xoá cả creds Google đã nạp từ .env.llm để case deterministic)
delete process.env.LUCY_MCP
delete process.env.GOOGLE_REFRESH_TOKEN; delete process.env.GOOGLE_ACCESS_TOKEN
for (const k of Object.keys(process.env)) if (k.startsWith('LUCY_MCP_')) delete process.env[k]

// ── Case A: master tắt → config rỗng (live an toàn) ──
console.log('=== A: master LUCY_MCP tắt ===')
assert('mcpMasterOn=false', mcpMasterOn() === false)
assert('mcpConfigFor → {} khi master tắt', Object.keys(mcpConfigFor(engineer, ctx)).length === 0)
assert('plan đánh dấu tất cả excluded reason "LUCY_MCP tắt"',
  mcpPlanFor(engineer, ctx).every((p) => !p.included && p.reason === 'LUCY_MCP tắt'))

// ── Case B: master bật → core no-auth mount ──
console.log('=== B: master bật, engineer ===')
process.env.LUCY_MCP = '1'
process.env.LUCY_VAULT = '/tmp/vault'
const cfgEng = mcpConfigFor(engineer, ctx)
const idsEng = Object.keys(cfgEng)
assert('engineer mount fs', idsEng.includes('fs'))
assert('engineer mount web', idsEng.includes('web'))
assert('engineer mount git (persona code)', idsEng.includes('git'))
assert('engineer mount memory (có LUCY_VAULT)', idsEng.includes('memory'))
assert('keys sort ổn định (prompt-cache)', JSON.stringify(idsEng) === JSON.stringify([...idsEng].sort()))
assert('allowedTools = mcp__<id>', JSON.stringify(mcpAllowedTools(cfgEng)) === JSON.stringify(idsEng.map((i) => `mcp__${i}`)))

// ── Case C: persona-scope — finance KHÔNG được git ──
console.log('=== C: persona-scope ===')
const idsFin = Object.keys(mcpConfigFor(finance, ctx))
assert('finance KHÔNG mount git (không thuộc scope code)', !idsFin.includes('git'))
assert('finance vẫn có web + memory', idsFin.includes('web') && idsFin.includes('memory'))
const planFinGit = mcpPlanFor(finance, ctx).find((p) => p.id === 'git')
assert('plan git cho finance reason scope', planFinGit?.included === false && /scope/.test(planFinGit?.reason || ''))

// ── Case D: per-server flag tắt ──
console.log('=== D: per-server flag ===')
process.env.LUCY_MCP_WEB = 'off'
assert('LUCY_MCP_WEB=off → loại web', !Object.keys(mcpConfigFor(engineer, ctx)).includes('web'))
delete process.env.LUCY_MCP_WEB

// ── Case E: memory cần LUCY_VAULT (build trả null khi thiếu) ──
console.log('=== E: memory cần vault ===')
delete process.env.LUCY_VAULT
const planMem = mcpPlanFor(engineer, { workspace: '/tmp/ws' }).find((p) => p.id === 'memory')
assert('không LUCY_VAULT → memory không build được', planMem?.included === false)
process.env.LUCY_VAULT = '/tmp/vault'

// ── Case F: circuit-breaker ──
console.log('=== F: circuit-breaker ===')
mcpResetBreaker()
mcpNoteFailure('web'); mcpNoteFailure('web'); mcpNoteFailure('web')
assert('web tripped sau 3 lỗi → bị loại', !Object.keys(mcpConfigFor(engineer, ctx)).includes('web'))
const planTrip = mcpPlanFor(engineer, ctx).find((p) => p.id === 'web')
assert('plan nêu circuit-breaker', /circuit-breaker/.test(planTrip?.reason || ''))
mcpResetBreaker()
assert('reset → web mount lại', Object.keys(mcpConfigFor(engineer, ctx)).includes('web'))

// ── Case G: registry sanity ──
console.log('=== G: registry sanity ===')
assert('có ≥4 core server', MCP_REGISTRY.length >= 4)
assert('id unique', new Set(MCP_REGISTRY.map((s) => s.id)).size === MCP_REGISTRY.length)
assert('core đều status live', MCP_REGISTRY.filter((s) => ['fs', 'web', 'git', 'memory'].includes(s.id)).every((s) => s.status === 'live'))

// ── Case H: T5 connectors scaffold — mặc định TẮT (scaffold), cần flag per-server + creds ──
console.log('=== H: T5 connectors scaffold ===')
delete process.env.GITHUB_TOKEN; delete process.env.NOTION_TOKEN
assert('registry có github/google/notion', ['github', 'google', 'notion'].every((id) => MCP_REGISTRY.some((s) => s.id === id)))
// scaffold mặc định serverEnabled=false → cần LUCY_MCP_GITHUB=on để cân nhắc mount
const planGhOff = mcpPlanFor(engineer, ctx).find((p) => p.id === 'github')
assert('github scaffold mặc định tắt (flag) → loại', planGhOff?.included === false && /flag/.test(planGhOff?.reason || ''))
process.env.LUCY_MCP_GITHUB = 'on'
const planGhNoTok = mcpPlanFor(engineer, ctx).find((p) => p.id === 'github')
assert('github bật flag nhưng thiếu token → reason creds', planGhNoTok?.included === false && /creds/.test(planGhNoTok?.reason || ''))
assert('không token → github KHÔNG vào config', !Object.keys(mcpConfigFor(engineer, ctx)).includes('github'))
process.env.GITHUB_TOKEN = 'ghp_dummy'
assert('flag on + token + persona code → github mount', Object.keys(mcpConfigFor(engineer, ctx)).includes('github'))
assert('github persona-scope: finance KHÔNG mount', !Object.keys(mcpConfigFor(finance, ctx)).includes('github'))
delete process.env.GITHUB_TOKEN; delete process.env.LUCY_MCP_GITHUB
process.env.LUCY_MCP_NOTION = 'on'; process.env.NOTION_TOKEN = 'secret_dummy'
assert('flag on + token → notion mount (mọi persona)', Object.keys(mcpConfigFor(finance, ctx)).includes('notion'))
delete process.env.NOTION_TOKEN; delete process.env.LUCY_MCP_NOTION
// G1 — google giờ LIVE (in-process readonly). Mặc định status=live nhưng gate creds GOOGLE_REFRESH_TOKEN.
const planGoogleNoCred = mcpPlanFor(engineer, ctx).find((p) => p.id === 'google')
assert('google thiếu GOOGLE_REFRESH_TOKEN → reason creds', planGoogleNoCred?.included === false && /creds/.test(planGoogleNoCred?.reason || ''))
assert('không refresh token → google KHÔNG vào config', !Object.keys(mcpConfigFor(engineer, ctx)).includes('google'))
process.env.GOOGLE_REFRESH_TOKEN = 'refresh_dummy'
const planGoogleCred = mcpPlanFor(engineer, ctx).find((p) => p.id === 'google')
// có refresh token → creds qua; mount thật còn cần file .gcp-oauth.json (build→googleConfigured). Bất kể, reason KHÔNG còn là 'creds'.
assert('google có refresh token → không còn block creds', !/creds/.test(planGoogleCred?.reason || ''))
const ovGoogle = mcpRegistryOverview().servers.find((s) => s.id === 'google')
assert('google overview status=live + envKeys GOOGLE_REFRESH_TOKEN', ovGoogle?.status === 'live' && ovGoogle?.envKeys.includes('GOOGLE_REFRESH_TOKEN'))
delete process.env.GOOGLE_REFRESH_TOKEN

// ── Case I: overview cho UI Kết nối ──
console.log('=== I: overview UI ===')
const ov = mcpRegistryOverview()
assert('overview.masterOn = mcpMasterOn', ov.masterOn === mcpMasterOn())
assert('overview liệt kê đủ server', ov.servers.length === MCP_REGISTRY.length)
assert('overview sort theo id', JSON.stringify(ov.servers.map((s) => s.id)) === JSON.stringify(ov.servers.map((s) => s.id).slice().sort()))
const ovGh = ov.servers.find((s) => s.id === 'github')
assert('github overview state=needs-creds (master on, no token)', ovGh?.state === 'needs-creds' && ovGh?.credsMissing.includes('GITHUB_TOKEN'))
const ovFs = ov.servers.find((s) => s.id === 'fs')
assert('fs overview state=live', ovFs?.state === 'live')
assert('mọi item có doc + scopeLabel', ov.servers.every((s) => typeof s.doc === 'string' && !!s.scopeLabel))
// master tắt → tất cả state master-off
delete process.env.LUCY_MCP
assert('master tắt → overview state master-off', mcpRegistryOverview().servers.every((s) => s.state === 'master-off'))
process.env.LUCY_MCP = '1'

// ── Case J: X3 — data thị trường (persona finance) ──
console.log('=== J: X3 finance data servers ===')
process.env.LUCY_MCP = '1'
assert('registry có binance/coingecko/twelvedata', ['binance', 'coingecko', 'twelvedata'].every((id) => MCP_REGISTRY.some((s) => s.id === id)))
const idsFinX3 = Object.keys(mcpConfigFor(finance, ctx))
assert('finance mount binance (keyless live)', idsFinX3.includes('binance'))
assert('finance mount coingecko (keyless live)', idsFinX3.includes('coingecko'))
assert('engineer KHÔNG mount binance (persona scope)', !Object.keys(mcpConfigFor(engineer, ctx)).includes('binance'))
const planTd = mcpPlanFor(finance, ctx).find((p) => p.id === 'twelvedata')
assert('twelvedata scaffold thiếu key → loại (reason creds)', planTd?.included === false && /creds|flag/.test(planTd?.reason || ''))
delete process.env.TWELVEDATA_API_KEY
process.env.LUCY_MCP_TWELVEDATA = 'on'
const planTd2 = mcpPlanFor(finance, ctx).find((p) => p.id === 'twelvedata')
assert('twelvedata flag on nhưng thiếu key → reason creds', planTd2?.included === false && /creds/.test(planTd2?.reason || ''))
process.env.TWELVEDATA_API_KEY = 'td_dummy'
assert('twelvedata flag on + key → mount cho finance', Object.keys(mcpConfigFor(finance, ctx)).includes('twelvedata'))
assert('twelvedata persona-scope: engineer KHÔNG mount', !Object.keys(mcpConfigFor(engineer, ctx)).includes('twelvedata'))
delete process.env.TWELVEDATA_API_KEY; delete process.env.LUCY_MCP_TWELVEDATA
const ovTd = mcpRegistryOverview().servers.find((s) => s.id === 'twelvedata')
assert('twelvedata overview state=needs-creds', ovTd?.state === 'needs-creds' && ovTd?.credsMissing.includes('TWELVEDATA_API_KEY'))

console.log(`\n=== ${pass} pass / ${fail} fail ===`)
process.exit(fail ? 1 : 0)
