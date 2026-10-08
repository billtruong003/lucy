// Smoke WIRING — chứng minh skill-loader THẬT SỰ được nối vào system prompt agent
// qua chính hàm runner dùng (buildSystemPrompt), KHÔNG chỉ test loadSkillBlock cô lập (smoke-skill.ts).
// Assert: card KHỚP → block skill CÓ trong prompt cuối + đúng nội dung + đúng thứ tự (skill TRƯỚC persona);
//         card KHÔNG khớp → KHÔNG chèn nhiễu. KHÔNG spawn claude, KHÔNG đốt token.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { buildSystemPrompt } from './runner'
import type { Card, Persona } from './types'

// ── Helpers (pattern smoke-skill.ts) ──
let pass = 0
let fail = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

const PERSONA_MARKER = '<<PERSONA_MARKER>>'
const SKILL_MARKER = '<<TDD_SKILL_BODY_MARKER>>'

function makeCard(title: string, brief: string): Card {
  return {
    id: 'wire', pipelineId: 'x', projectId: 'x', stageIndex: 0,
    title, brief, status: 'queued',
    workspace: '/tmp', blockedBy: [], depth: 0,
    history: [], cost: { usd: 0, inTok: 0, outTok: 0 },
    createdAt: 0, updatedAt: 0,
  }
}

const persona: Persona = {
  id: 'tester', name: 'Tester', model: 'sonnet',
  systemPrompt: `Bạn là tester. ${PERSONA_MARKER} làm việc theo kỷ luật.`,
}

// ── Temp LUCY_SKILLS dir (pattern test-skill-loader.ts:44-57) + restore env (withSkillsDir) ──
const prevSkills = process.env.LUCY_SKILLS
const prevVault = process.env.LUCY_VAULT
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-wire-'))
fs.writeFileSync(
  path.join(dir, 'INDEX.md'),
  '# INDEX\n\n- **test-driven-development** — TDD viết test trước theo RED GREEN REFACTOR. · [`skills/tdd/SKILL.md`](skills/tdd/SKILL.md)\n'
)
fs.mkdirSync(path.join(dir, 'tdd'), { recursive: true })
fs.writeFileSync(
  path.join(dir, 'tdd', 'SKILL.md'),
  `# Test-Driven Development\n\n${SKILL_MARKER}\nRED → GREEN → REFACTOR: viết test trước, để nó đỏ, rồi code cho xanh.\n`
)
process.env.LUCY_SKILLS = dir
delete process.env.LUCY_VAULT // digest đã-học = '' → assert thứ tự sạch, không phụ thuộc vault máy chạy

try {
  // ── Case A: card khớp TDD → skill được CHÈN qua đúng hàm runner dùng ──
  console.log('=== Case A: Card khớp TDD → skill chèn vào prompt ===')
  const sysA = buildSystemPrompt(makeCard('TDD Task', 'viết unit test trước khi code theo test driven development'), persona)
  console.log(`   buildSystemPrompt → ${sysA.length} ký tự`)

  assert('prompt CÓ header "SKILL ÁP DỤNG" (skill đã load)', sysA.includes('SKILL ÁP DỤNG'))
  assert('prompt CÓ nội dung SKILL.md (đúng skill, không header suông)', sysA.includes(SKILL_MARKER))
  assert('prompt CÓ persona marker', sysA.includes(PERSONA_MARKER))
  assert('prompt CÓ OUTCOME_CONTRACT ("QUY TẮC KẾT THÚC")', sysA.includes('QUY TẮC KẾT THÚC'))
  // C1 (Đợt C) cache-parity layout: house+contract+PERSONA (tĩnh) → SKILL (theo-card) → digest+brain (động).
  // → persona đứng TRƯỚC skill (đảo so với trước) để prefix tĩnh dài, trúng prefix-cache.
  assert('thứ tự C1: PERSONA trước SKILL (tĩnh trước theo-card)', sysA.indexOf(PERSONA_MARKER) < sysA.indexOf('SKILL ÁP DỤNG'),
    `persona@${sysA.indexOf(PERSONA_MARKER)} vs skill@${sysA.indexOf('SKILL ÁP DỤNG')}`)
  assert('thứ tự C1: CONTRACT (tĩnh) đứng trước SKILL', sysA.indexOf('QUY TẮC KẾT THÚC') < sysA.indexOf('SKILL ÁP DỤNG'))

  console.log('\n📋 Đoạn đầu prompt:')
  console.log(sysA.slice(0, 300))
  console.log('...\n')

  // ── Case B: card không khớp → KHÔNG chèn skill (không nhiễu) ──
  console.log('=== Case B: Card không khớp → không chèn skill ===')
  const sysB = buildSystemPrompt(makeCard('Hello World', 'tạo file hello.txt đơn giản'), persona)
  assert('prompt KHÔNG có "SKILL ÁP DỤNG"', !sysB.includes('SKILL ÁP DỤNG'),
    `lọt: "${sysB.slice(sysB.indexOf('SKILL ÁP DỤNG'), sysB.indexOf('SKILL ÁP DỤNG') + 50)}"`)
  assert('prompt vẫn có persona + contract', sysB.includes(PERSONA_MARKER) && sysB.includes('QUY TẮC KẾT THÚC'))
} finally {
  // restore env + dọn temp (pattern withSkillsDir)
  if (prevSkills === undefined) delete process.env.LUCY_SKILLS; else process.env.LUCY_SKILLS = prevSkills
  if (prevVault === undefined) delete process.env.LUCY_VAULT; else process.env.LUCY_VAULT = prevVault
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log(`\n=== KẾT QUẢ: ${pass} pass / ${fail} fail ===`)
if (fail > 0) { console.log('❌ SMOKE FAILED'); process.exit(1) }
console.log('✅ SMOKE PASSED')
process.exit(0)
