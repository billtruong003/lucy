// Smoke CL-3 — cầu Registry→MCP. KHÔNG mạng, KHÔNG spawn claude. Chỉ kiểm LOGIC gating + adapter dựng được.
import { mcpConfigFor, mcpPlanFor } from './mcp-registry'
import { registryMcpServer, registryBothPaths, jsonSchemaToZodShape, REGISTRY_MCP_DEFAULT_TOOLSETS } from './tools/registry-mcp'
import type { Persona } from './types'

let pass = 0, fail = 0
const assert = (l: string, ok: boolean, d?: string) => { ok ? (console.log('  ✅ ' + l), pass++) : (console.log(`  ❌ ${l}${d ? ' — ' + d : ''}`), fail++) }

const eng: Persona = { id: 'engineer', name: 'Engineer', systemPrompt: 'code', model: 'sonnet', kind: 'specialist' }
const ctx = { workspace: '/tmp/ws', repoRoot: '/tmp/ws' }
const tctx = { ws: '/tmp/ws', mode: 'runner' as const }

// env sạch
delete process.env.LUCY_MCP
for (const k of Object.keys(process.env)) if (k.startsWith('LUCY_MCP_')) delete process.env[k]

console.log('=== A: LUCY_MCP OFF → hành vi cũ (không có server registry) ===')
assert('mcpConfigFor không chứa "registry"', !('registry' in mcpConfigFor(eng, ctx)))
assert('plan: registry excluded reason "LUCY_MCP tắt"',
  mcpPlanFor(eng, ctx).find((p) => p.id === 'registry')?.reason === 'LUCY_MCP tắt')

console.log('=== B: LUCY_MCP=1 nhưng LUCY_MCP_REGISTRY chưa set → scaffold mặc định TẮT ===')
process.env.LUCY_MCP = '1'
assert('mcpConfigFor vẫn KHÔNG mount registry (default off)', !('registry' in mcpConfigFor(eng, ctx)))
assert('plan: registry excluded reason "server tắt (flag)"',
  mcpPlanFor(eng, ctx).find((p) => p.id === 'registry')?.reason === 'server tắt (flag)')

console.log('=== C: LUCY_MCP=1 + LUCY_MCP_REGISTRY=on → mount + build được ===')
process.env.LUCY_MCP_REGISTRY = 'on'
const cfg = mcpConfigFor(eng, ctx)
assert('registry có trong mcpConfigFor', 'registry' in cfg)
assert('server config là object', !!cfg.registry && typeof cfg.registry === 'object')

console.log('=== D: 1 handler 2 đầu ra (cùng toolset) ===')
const both = registryBothPaths(REGISTRY_MCP_DEFAULT_TOOLSETS, tctx)
assert('laneDefs = 6 tool (web×2 + fs-rw×4)', both.laneDefs.length === 6, String(both.laneDefs.length))
assert('mcpServer dựng được (non-null)', both.mcpServer != null)
const laneNames = both.laneDefs.map((d) => d.function.name).sort()
assert('lane có read_file/web_search', laneNames.includes('read_file') && laneNames.includes('web_search'))

console.log('=== E: jsonSchemaToZodShape — required vs optional ===')
const shape = jsonSchemaToZodShape({ type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'number' } }, required: ['symbol'] })
assert('symbol required (parse fail khi thiếu)', !shape.symbol.safeParse(undefined).success)
assert('limit optional (parse ok khi thiếu)', shape.limit.safeParse(undefined).success)

console.log('=== F: toolset lạ → null (không vỡ) ===')
assert('registryMcpServer([khong-ton-tai]) = null', registryMcpServer(['khong-ton-tai-xyz'], tctx) === null)

console.log(`\n${fail ? '❌' : '✅'} CL-3 smoke: ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
