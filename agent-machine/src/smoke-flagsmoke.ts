// CL-FLAGSMOKE — behavior verify cô lập 3 flag (HOOKS/TOOL_REGISTRY/MCP_REGISTRY).
// Chứng minh ON khác OFF đúng kỳ vọng. KHÔNG mạng/đốt token/đụng process LIVE.
import { dangerousBash, buildHookOptions } from './tool-hooks'
import { getLaneToolDefs, getToolManifest, toolRegistryEnabled } from './tools/registry'
import { registerLaneTools } from './tools/lane-tools'
import { registryBothPaths, REGISTRY_MCP_DEFAULT_TOOLSETS } from './tools/registry-mcp'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, d = '') => { c ? (pass++, console.log('  ✅', l)) : (fail++, console.log('  ❌', l, d)) }

console.log('=== CL-1 HOOKS: guard chặn Bash nguy (dangerousBash) ===')
ok('chặn "rm -rf /"', dangerousBash('rm -rf /') != null)
ok('chặn "git push origin main"', dangerousBash('git push origin main') != null)
ok('chặn "pm2 restart lucy-bridge"', dangerousBash('pm2 restart lucy-bridge') != null)
ok('cho qua "rm -rf ./build"', dangerousBash('rm -rf ./build') == null)
ok('cho qua "npx tsc --noEmit"', dangerousBash('npx tsc --noEmit') == null)
delete process.env.LUCY_HOOKS
ok('OFF → buildHookOptions = {} (keys 0)', Object.keys(buildHookOptions({})).length === 0)
process.env.LUCY_HOOKS = '1'
const hk = Object.keys(buildHookOptions({})).sort()
ok('ON → có canUseTool + hooks', hk.includes('canUseTool') && hk.includes('hooks'), JSON.stringify(hk))
delete process.env.LUCY_HOOKS

console.log('=== CL-2 TOOL_REGISTRY: getLaneToolDefs + getToolManifest ===')
registerLaneTools()
delete process.env.LUCY_TOOL_REGISTRY
ok('OFF → toolRegistryEnabled()=false', toolRegistryEnabled() === false)
process.env.LUCY_TOOL_REGISTRY = '1'
ok('ON → toolRegistryEnabled()=true', toolRegistryEnabled() === true)
const defs = getLaneToolDefs('lucy-lane')
const names = defs.map((d) => d.function.name)
ok('getLaneToolDefs("lucy-lane") trả tool từ registry (≥6)', defs.length >= 6, String(defs.length))
ok('có web_search + read_file', names.includes('web_search') && names.includes('read_file'))
const man = getToolManifest(['lucy-lane'])
ok('getToolManifest() ra block (non-empty, có tên tool)', man.length > 50 && man.includes('web_search'), String(man.length))
delete process.env.LUCY_TOOL_REGISTRY

console.log('=== CL-3 MCP_REGISTRY: adapter registry→MCP build được server ===')
const both = registryBothPaths(REGISTRY_MCP_DEFAULT_TOOLSETS, { ws: '/tmp/ws', mode: 'runner' })
ok('mcpServer dựng được (non-null)', both.mcpServer != null)
ok('laneDefs cùng handler (6 tool)', both.laneDefs.length === 6, String(both.laneDefs.length))

console.log(`\n${fail ? '❌' : '✅'} CL-FLAGSMOKE behavior: ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
