// Smoke K4: persona-config sanitize + ghi/xoá file FS-confined.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sanitizePersona, writePersonaFile, deletePersonaFile, validPersonaId } from './persona-config'

let pass = 0, fail = 0
function ok(name: string, cond: boolean) { if (cond) { pass++; console.log('  ✅ ' + name) } else { fail++; console.log('  ❌ ' + name) } }

// ── validPersonaId ──
ok('id hợp lệ: finance', validPersonaId('finance'))
ok('id hợp lệ: eru_finance-2', validPersonaId('eru_finance-2'))
ok('id từ chối: ../evil', !validPersonaId('../evil'))
ok('id từ chối: rỗng', !validPersonaId(''))
ok('id từ chối: có /', !validPersonaId('a/b'))

// ── sanitizePersona ──
ok('thiếu systemPrompt → null', sanitizePersona({ id: 'x', name: 'X' }) === null)
ok('thiếu name → null', sanitizePersona({ id: 'x', systemPrompt: 'p' }) === null)
ok('id bẩn → null', sanitizePersona({ id: '../e', name: 'X', systemPrompt: 'p' }) === null)

const p = sanitizePersona({ id: 'k4t', name: 'K4', systemPrompt: 'sp', model: 'opus', kind: 'specialist', tags: ['a', '', 'b'], allowedTools: ['Read', 'Bash', 'Evil', 'Read'], maxTurns: 999, timeoutSec: -5, junk: 'drop' })
ok('persona dựng được', !!p)
ok('model giữ opus', p?.model === 'opus')
ok('model lạ → sonnet', sanitizePersona({ id: 'k', name: 'K', systemPrompt: 's', model: 'gpt9' })?.model === 'sonnet')
ok('tags lọc rỗng', JSON.stringify(p?.tags) === JSON.stringify(['a', 'b']))
ok('tools whitelist + dedup', JSON.stringify(p?.allowedTools) === JSON.stringify(['Read', 'Bash']))
ok('maxTurns clamp ≤64', p?.maxTurns === 64)
ok('timeoutSec âm → bỏ', p?.timeoutSec === undefined)
ok('junk field bị loại', !('junk' in (p as any)))

// ── write/delete file FS-confined ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'k4-'))
ok('write file ok', writePersonaFile(tmp, p!))
ok('file tồn tại + parse được', JSON.parse(fs.readFileSync(path.join(tmp, 'personas', 'k4t.json'), 'utf8')).id === 'k4t')
ok('write id bẩn bị chặn', !writePersonaFile(tmp, { ...p!, id: '../escape' }))
ok('không tạo file ngoài personas/', !fs.existsSync(path.join(tmp, 'escape.json')))
ok('delete file ok', deletePersonaFile(tmp, 'k4t'))
ok('file đã mất', !fs.existsSync(path.join(tmp, 'personas', 'k4t.json')))
ok('delete id không tồn tại → false', !deletePersonaFile(tmp, 'nope'))
ok('delete id bẩn → false', !deletePersonaFile(tmp, '../x'))
fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n${fail ? '❌' : '✅'} ${fail ? 'FAIL' : 'ALL PASS'} — ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
