// Adversarial repro cho error-stats.classifyTurn — tester (Kocho).
// Mục tiêu: chứng minh false-positive khi motive là FREE-TEXT của agent
// (lane-runner.ts:122 ghi motive = raw.replace(/\n/g,' ') = nguyên văn agent),
// trong khi classifyTurn:66 dò startsWith('hết ') KHÔNG gate theo decision.
import { classifyTurn } from './error-stats'

let bug = 0
function expect(name: string, got: unknown, want: unknown) {
  const ok = got === want
  if (!ok) bug++
  console.log(`  ${ok ? '✅' : '❌ BUG'} ${name}  (got=${String(got)} · want=${String(want)})`)
}

console.log('🐛 repro: outcome THÀNH CÔNG bị tính nhầm thành lỗi vì free-text motive')

// BUG 1 — outcome decision='advance' (THÀNH CÔNG) nhưng agent viết tự nhiên
// bắt đầu "hết sức..." và có chữ "salvage" → bị xếp 'salvage' (lỗi). Phải null.
expect(
  "advance + motive 'hết sức tốt, đã salvage flow' → PHẢI null",
  classifyTurn({ agent: 'builder', action: 'outcome', motive: 'hết sức tốt, đã salvage lại flow xong xuôi', outcome: 'done', decision: 'advance' }),
  null,
)

// BUG 2 — outcome decision='done' (THÀNH CÔNG) nhưng câu chữ chứa "không ra gì"
// và mở đầu "hết " → bị xếp 'out-of-turns'. Phải null.
expect(
  "done + motive 'hết bước, không ra gì thêm' → PHẢI null",
  classifyTurn({ agent: 'builder', action: 'outcome', motive: 'hết bước này rồi, không ra gì thêm để làm', outcome: 'ok', decision: 'done' }),
  null,
)

// BUG 3 (phụ) — fail thật do logic nghiệp vụ, agent nhắc chữ "outcome" trong câu
// → bị nhét vào 'wrong-output' (đáng lẽ 'other'). 'outcome' là KW quá phổ biến
// vì agent buộc phải kết thúc bằng khối JSON outcome.
expect(
  "rework, lỗi logic, có chữ 'outcome' → 'other' chứ KHÔNG phải 'wrong-output'",
  classifyTurn({ agent: 'builder', action: 'outcome', motive: 'logic tính sai, trả lại để sửa rồi nộp outcome', outcome: 'sai kết quả', decision: 'rework' }),
  'other',
)

// Đối chứng: terminal record THẬT từ producer (lane-runner.ts:136) vẫn phải đúng.
expect(
  "đối chứng producer 'hết 16 turn — salvage' → salvage",
  classifyTurn({ agent: 'builder', action: 'outcome', motive: 'hết 16 turn — salvage', outcome: 's', decision: 'advance' }),
  'salvage',
)
expect(
  "đối chứng producer 'hết 16 turn — không ra gì' → out-of-turns",
  classifyTurn({ agent: 'builder', action: 'outcome', motive: 'hết 16 turn — không ra gì', outcome: 's', decision: 'needs_decision' }),
  'out-of-turns',
)

console.log(`\n${bug === 0 ? '✅ KHÔNG có bug' : `❌ ${bug} BUG tái hiện được`}`)
process.exit(bug === 0 ? 1 : 0) // exit 0 = đã chứng minh bug (để dễ thấy)
