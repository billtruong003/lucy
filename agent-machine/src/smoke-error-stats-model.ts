// Adversarial repro — tester (Kocho): attribution MODEL của error-stats sai khi
// model THỰC chạy lane ≠ persona.laneModel trong config.
//
// Gốc rễ: TurnRecord (turn-log.ts) KHÔNG có field `model`. LaneRunner biết model
// thực lúc ghi (`persona.laneModel || 'executor'`, lane-runner.ts:83) nhưng KHÔNG
// ghi vào record. error-stats.ts:134-135 buộc phải SUY LẠI từ store.personas
// (`p?.laneModel ?? p?.model ?? 'unknown'`) → lệch trong 2 ca có thật:
//
//  (A) TokenGuard SOFT hạ cấp executor: engine.ts:383 set laneModel = cheapestAvailableLaneKey()
//      trên BẢN COPY gửi worker (KHÔNG persist). engineer config laneModel='devstral-med'
//      nhưng run thực chạy 'ds-v4-flash-free' → byModel gom nhầm hết về 'devstral-med'.
//  (B) `??` (nullish) ≠ `||` (truthy): laneModel='' → LaneRunner chạy 'executor',
//      error-stats gắn nhãn '' (rỗng).
//  (C) Dòng JSONL CŨ thiếu `decision` (turn-log.ts:22 nói tương thích ngược) mà là
//      outcome FAIL → classifyTurn:72 gate `t.decision && ...` = false → trả null
//      → lỗi thật bị đếm thành THÀNH CÔNG (false negative).
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { buildErrorStats, classifyTurn } from './error-stats'
import type { Persona } from './types'

let bug = 0
function expect(name: string, got: unknown, want: unknown) {
  const ok = got === want
  if (!ok) bug++
  console.log(`  ${ok ? '✅' : '❌ BUG'} ${name}\n       got=${JSON.stringify(got)} · want=${JSON.stringify(want)}`)
}
const tmp = (n: string) => { const d = path.join(process.cwd(), '.smoke', n); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); return d }
function persona(p: Partial<Persona> & { id: string }): Persona {
  return { name: p.id, model: 'sonnet', systemPrompt: '', allowedTools: [], ...p }
}
function writeLog(dir: string, recs: object[]) {
  fs.writeFileSync(path.join(dir, 'turn-log.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

console.log('🐛 repro: attribution MODEL sai khi model thực ≠ persona.laneModel\n')

// ── (A) TokenGuard SOFT downgrade: engineer chạy 2 lần, 1 lần model config (devstral-med),
//        1 lần bị hạ xuống ds-v4-flash-free. Record turn-log KHÔNG mang model thực.
{
  const dir = tmp('errstats-model-A')
  writeLog(dir, [
    // run thường: lane = devstral-med (config). Sau fix: LaneRunner ghi model THỰC vào record.
    { agent: 'engineer', model: 'devstral-med', task: 'c1', stage: 's', motive: 'sửa', action: 'outcome', outcome: 'tsc lỗi', turnCount: 3, token: 10, decision: 'fail' },
    // run sau SOFT: engine ép laneModel='ds-v4-flash-free' → record mang đúng model rẻ nhất.
    { agent: 'engineer', model: 'ds-v4-flash-free', task: 'c2', stage: 's', motive: 'sửa', action: 'outcome', outcome: 'tsc lỗi', turnCount: 3, token: 10, decision: 'fail' },
  ])
  const store = new Store(tmp('errstats-model-A-state'))
  store.registerPersona(persona({ id: 'engineer', model: 'sonnet', laneModel: 'devstral-med', kind: 'executor' }))

  const stats = buildErrorStats(store, dir)
  const md = Object.fromEntries(stats.byModel.map((m) => [m.model, m.count]))
  // SPEC card: "đếm theo MODEL" = model THỰC chạy. Đúng phải tách 1 devstral-med + 1 ds-v4-flash-free.
  expect('(A) ds-v4-flash-free (run bị SOFT hạ cấp) phải có 1 lỗi', md['ds-v4-flash-free'] ?? 0, 1)
  expect('(A) devstral-med chỉ 1 lỗi (không nuốt luôn run đã hạ cấp)', md['devstral-med'] ?? 0, 1)
}

// ── (B) laneModel='' : LaneRunner chạy 'executor' (||), error-stats gắn '' (??).
{
  const dir = tmp('errstats-model-B')
  writeLog(dir, [
    // LaneRunner: `'' || 'executor'` → ghi model='executor' vào record (lane-runner.ts:83).
    { agent: 'x', model: 'executor', task: 'c', stage: 's', motive: 'hết 16 turn — không ra gì', action: 'outcome', outcome: 'kẹt', turnCount: 16, token: 0, decision: 'needs_decision' },
  ])
  const store = new Store(tmp('errstats-model-B-state'))
  store.registerPersona(persona({ id: 'x', model: 'sonnet', laneModel: '' }))
  const stats = buildErrorStats(store, dir)
  const labels = stats.byModel.map((m) => m.model)
  // LaneRunner: `'' || 'executor'` → 'executor'. error-stats không được đẻ nhãn rỗng.
  expect("(B) laneModel='' phải gắn 'executor', KHÔNG để nhãn rỗng", labels.includes('') ? '<empty>' : labels[0], 'executor')
}

// ── (C) Dòng cũ thiếu `decision` + outcome FAIL theo keyword → bị đếm null (false negative).
{
  // Trước fix (dùng keyword) record này là lỗi build-fail; sau fix (gate decision) → null.
  const got = classifyTurn({ agent: 'x', action: 'outcome', motive: 'tsc compile lỗi type', outcome: 'build fail' } as never)
  expect("(C) outcome FAIL thiếu decision (log cũ) vẫn phải nhận diện là lỗi", got, 'build-fail')
}

console.log(`\n${bug === 0 ? '✅ KHÔNG tái hiện bug' : `❌ ${bug} BUG/khác-biệt tái hiện được`}`)
process.exit(bug === 0 ? 1 : 0) // exit 0 = đã chứng minh có vấn đề
