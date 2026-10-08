// CL-2 smoke: registry resolve/def/dispatch/manifest + sandbox parity (chat vs runner). KHÔNG mạng/đốt token.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registry, getLaneToolDefs, dispatchTool, getToolManifest, sanitizeError } from './tools/registry'
import { registerLaneTools } from './tools/lane-tools'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, extra = '') { if (cond) { pass++; console.log('✅', name) } else { fail++; console.log('❌', name, extra) } }

registerLaneTools()

// 1. resolveToolset lồng nhau + dedup
const lane = registry.resolveToolset('lucy-lane')
ok('lucy-lane = 7 tool (web+fs-rw+bash)', lane.length === 7 && lane.includes('web_search') && lane.includes('bash'), JSON.stringify(lane))
const runner = registry.resolveToolset('lucy-runner')
ok('lucy-runner = 5 tool (fs-rw+bash, KHÔNG web)', runner.length === 5 && !runner.includes('web_search') && runner.includes('edit_file'), JSON.stringify(runner))

// 2. alias + cycle guard
registry.registerAlias('lane-alias', 'lucy-lane')
ok('alias resolve', registry.resolveToolset('lane-alias').length === 7)
registry.registerToolset('cyc-a', ['cyc-b']); registry.registerToolset('cyc-b', ['cyc-a', 'bash'])
ok('cycle guard không treo + vẫn lấy bash', registry.resolveToolset('cyc-a').includes('bash'))

// 3. laneToolDefs format OpenAI
const defs = getLaneToolDefs('lucy-runner')
ok('ToolDef đúng format', defs.every((d) => d.type === 'function' && !!d.function.name && !!d.function.parameters))

// 4. dispatch read_file (chat mode, path tuyệt đối) — đọc chính file này
const self = path.resolve('src/smoke-tool-registry.ts')
const rfChat = await dispatchTool('read_file', { path: self }, { ws: process.cwd(), mode: 'chat' })
ok('dispatch read_file chat (abs path)', rfChat.includes('CL-2 smoke'))

// 5. sandbox runner CHẶN path ngoài workspace; chat CHO path tuyệt đối ngoài ws
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cl2-'))
const outside = path.join(tmp, 'x.txt'); fs.writeFileSync(outside, 'hello-outside')
const rfRunnerOut = await dispatchTool('read_file', { path: outside }, { ws: process.cwd(), mode: 'runner' })
ok('runner CHẶN ngoài workspace', rfRunnerOut.startsWith('ERROR') && rfRunnerOut.includes('ngoài workspace'), rfRunnerOut.slice(0, 80))
const rfChatOut = await dispatchTool('read_file', { path: outside }, { ws: process.cwd(), mode: 'chat' })
ok('chat CHO path tuyệt đối ngoài ws', rfChatOut.includes('hello-outside'))

// 6. blacklist nhạy cảm (chat)
const sens = await dispatchTool('read_file', { path: '/root/.ssh/id_rsa' }, { ws: process.cwd(), mode: 'chat' })
ok('chat chặn path nhạy cảm', sens.startsWith('ERROR') && sens.includes('nhạy cảm'), sens.slice(0, 80))

// 7. runner perm-gate: persona KHÔNG có Write → write_file bị chặn
const noWrite = new Set(['Read'])
const wr = await dispatchTool('write_file', { path: 'z.txt', content: 'x' }, { ws: tmp, mode: 'runner', allowed: noWrite })
ok('runner gate quyền (không Write)', wr.startsWith('ERROR') && wr.includes('không được phép'), wr.slice(0, 80))

// 8. write/edit round-trip trong workspace (runner) + chuỗi trả khác mode
const wOk = await dispatchTool('write_file', { path: 'a.txt', content: 'one' }, { ws: tmp, mode: 'runner', allowed: new Set(['Write']) })
ok('runner write trả "(N ký tự)"', /đã ghi a\.txt \(3 ký tự\)/.test(wOk), wOk)
const wChat = await dispatchTool('write_file', { path: path.join(tmp, 'b.txt'), content: 'two' }, { ws: tmp, mode: 'chat' })
ok('chat write trả path tuyệt đối', wChat.startsWith('đã ghi ') && wChat.includes(tmp), wChat)

// 9. tool lạ → ERROR chuẩn
const bad = await dispatchTool('khong_co_tool', {}, { ws: tmp, mode: 'chat' })
ok('tool lạ → ERROR', bad === 'ERROR: tool lạ "khong_co_tool"', bad)

// 10. sanitizeError cắt framing + cap
const san = sanitizeError('```bad <tag>X</tag> <![CDATA[y]]>```', 50)
ok('sanitizeError strip framing', !san.includes('```') && !san.includes('<tag>') && san.includes('X'), san)

// 11. manifest có header + liệt kê tool
const man = getToolManifest()
ok('manifest có header + read_file', man.includes('TOOL EM CÓ') && man.includes('read_file') && man.includes('binance_price'))
console.log('\n--- MANIFEST PREVIEW ---\n' + man.trim())

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n=== ${pass} pass / ${fail} fail ===`)
process.exit(fail ? 1 : 0)
