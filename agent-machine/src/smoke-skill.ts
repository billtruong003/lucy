// Smoke test — Skill-loader M3
// Case A: card khớp TDD → load block chứa nội dung TDD, IN ra chứng minh
// Case B: card không liên quan → loadSkillBlock trả ''
// KHÔNG spawn claude, KHÔNG đốt token.

import { loadSkillBlock } from './skill-loader'

function pad(s: string, n: number): string {
  return s + ' '.repeat(Math.max(0, n - s.length))
}

let pass = 0
let fail = 0

function assert(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✅ ${label}`)
    pass++
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
    fail++
  }
}

// ── Case A: match TDD ──
console.log('=== Case A: Card khớp TDD ===')
const cardA = {
  title: 'TDD Task',
  brief: 'viết unit test trước khi code, theo TDD — RED-GREEN-REFACTOR',
  id: 'test-a', pipelineId: 'x', projectId: 'x', stageIndex: 0,
  status: 'queued' as const,
  workspace: '/tmp', blockedBy: [] as string[], depth: 0,
  history: [] as any[], cost: { usd: 0, inTok: 0, outTok: 0 },
  createdAt: 0, updatedAt: 0,
}
const block = loadSkillBlock(cardA)
// token-count xấp xỉ theo cùng tỉ lệ loader dùng (CHARS_PER_TOKEN=4), cap=6000
const CHARS_PER_TOKEN = 4
const TOKEN_CAP = 6000
const estTokens = Math.ceil(block.length / CHARS_PER_TOKEN)
console.log(`   loadSkillBlock → ${block.length} ký tự ≈ ${estTokens} token (cap ${TOKEN_CAP})`)

assert('block không rỗng', block.length > 0)
assert('chứa header SKILL ÁP DỤNG', block.startsWith('SKILL ÁP DỤNG'))
const hasTDD = /Test-Driven Development|RED.GREEN|test-driven-development|TDD/i.test(block)
assert('chứa nội dung TDD', hasTDD, 'regex kiểm tra TDD/RED-GREEN không match')
assert('kết thúc bằng ---', block.trim().endsWith('---'))
assert(`token ≤ ${TOKEN_CAP}`, estTokens <= TOKEN_CAP, `${estTokens} token vượt cap`)

// In đoạn đầu để chứng minh
console.log('\n📋 Đoạn đầu block:')
console.log(block.slice(0, 400))
console.log('...\n')

// ── Case B: no match ──
console.log('=== Case B: Card không match ===')
const cardB = {
  title: 'Hello World',
  brief: 'tạo file hello.txt đơn giản',
  id: 'test-b', pipelineId: 'x', projectId: 'x', stageIndex: 0,
  status: 'queued' as const,
  workspace: '/tmp', blockedBy: [] as string[], depth: 0,
  history: [] as any[], cost: { usd: 0, inTok: 0, outTok: 0 },
  createdAt: 0, updatedAt: 0,
}
const blockB = loadSkillBlock(cardB)
console.log(`   loadSkillBlock → "${blockB}" (${blockB.length} ký tự)`)

assert('block rỗng', blockB === '', `kỳ vọng '' nhưng được "${blockB.slice(0,50)}"`)

// ── Kết quả ──
console.log(`\n=== KẾT QUẢ: ${pass} pass / ${fail} fail ===`)
if (fail > 0) {
  console.log('❌ SMOKE FAILED')
  process.exit(1)
} else {
  console.log('✅ SMOKE PASSED')
  process.exit(0)
}