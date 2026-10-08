// Smoke test turn-log — assert ghi/đọc JSONL đúng, edge-case, utf-8.
// Chạy: npx tsx src/smoke-turn-log.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTurnLogger, NoopTurnLogger, type TurnRecord } from './turn-log'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

// helper: đọc toàn bộ file JSONL thành mảng object (per-line catch — 1 dòng lỗi không mất hết)
function readJSONL(file: string): unknown[] {
  const txt = fs.readFileSync(file, 'utf8')
  if (!txt.trim()) return []
  return txt.trim().split('\n').flatMap((line) => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
}

// ── Test 1: NoopTurnLogger ──
function t1() {
  console.log('\nT1 — NoopTurnLogger: không ghi gì cả')
  const logger = new NoopTurnLogger()
  let called = false
  const original = fs.appendFileSync
  // @ts-expect-error — override để catch
  fs.appendFileSync = (_path: string, _data: string) => { called = true }
  logger.log({
    agent: 'tester', task: 't1', stage: 's1', motive: 'test', action: 'tool_call',
    outcome: '', turnCount: 0, token: 100,
  })
  fs.appendFileSync = original
  check('NoopTurnLogger không gọi fs.appendFileSync', !called)
}

// ── Test 2: FileTurnLogger ghi đúng JSONL ──
function t2() {
  console.log('\nT2 — FileTurnLogger: ghi JSONL đúng format')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-t2-'))
  const old = process.env.AM_TURNS_LOG
  process.env.AM_TURNS_LOG = dir
  const logger = createTurnLogger()
  const rec: TurnRecord = {
    agent: 'executor', task: 'card-abc', stage: 'build',
    motive: 'đang đọc file config', action: 'tool_call',
    outcome: '', turnCount: 0, token: 456,
  }
  logger.log(rec)
  const file = path.join(dir, 'turn-log.jsonl')
  check('file tồn tại', fs.existsSync(file))
  const lines = readJSONL(file)
  check('ghi đúng 1 dòng', lines.length === 1, `(got ${lines.length})`)
  if (lines.length >= 1) {
    const entry = lines[0] as Record<string, unknown>
    check('record.agent === "executor"', entry.agent === 'executor')
    check('record.task === "card-abc"', entry.task === 'card-abc')
    check('record.turnCount === 0', entry.turnCount === 0)
    check('record.token === 456', entry.token === 456)
    check('record.action === "tool_call"', entry.action === 'tool_call')
  }
  process.env.AM_TURNS_LOG = old
  fs.rmSync(dir, { recursive: true, force: true })
}

// ── Test 3: FileTurnLogger ghi nhiều dòng ──
function t3() {
  console.log('\nT3 — FileTurnLogger: nhiều dòng, mỗi dòng 1 JSON hợp lệ')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-t3-'))
  process.env.AM_TURNS_LOG = dir
  // createTurnLogger reads env at call time
  const log2 = createTurnLogger()
  for (let i = 0; i < 5; i++) {
    log2.log({ agent: 'a', task: 't', stage: 's', motive: `turn ${i}`, action: 'text', outcome: '', turnCount: i, token: 10 })
  }
  const file = path.join(dir, 'turn-log.jsonl')
  const lines = readJSONL(file)
  check('ghi đúng 5 dòng', lines.length === 5, `(got ${lines.length})`)
  const last = lines[lines.length - 1] as Record<string, unknown>
  check('dòng cuối turnCount = 4', last.turnCount === 4)
  delete process.env.AM_TURNS_LOG
  fs.rmSync(dir, { recursive: true, force: true })
}

// ── Test 4: Truncation: motive > 200, outcome > 500 ──
function t4() {
  console.log('\nT4 — Truncation: motive/outcome quá dài bị cắt')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-t4-'))
  process.env.AM_TURNS_LOG = dir
  const logger = createTurnLogger()
  const longMotive = 'x'.repeat(250)
  const longOutcome = 'y'.repeat(600)
  logger.log({ agent: 'a', task: 't', stage: 's', motive: longMotive, action: 'text', outcome: longOutcome, turnCount: 0, token: 0 })
  const file = path.join(dir, 'turn-log.jsonl')
  const lines = readJSONL(file)
  const entry = lines[0] as Record<string, unknown>
  check('motive bị cắt (≤ 201 = 200 + "…")', typeof entry.motive === 'string' && (entry.motive as string).length <= 201, `(len=${(entry.motive as string).length})`)
  check('outcome bị cắt (≤ 501 = 500 + "…")', typeof entry.outcome === 'string' && (entry.outcome as string).length <= 501, `(len=${(entry.outcome as string).length})`)
  check('motive kết thúc bằng … (U+2026)', String(entry.motive).endsWith('…'))
  delete process.env.AM_TURNS_LOG
  fs.rmSync(dir, { recursive: true, force: true })
}

// ── Test 5: UTF-8 edge: emoji, Vietnamese, surrogate pairs ──
function t5() {
  console.log('\nT5 — UTF-8 edge: emoji + tiếng Việt → không sinh lone surrogate')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-t5-'))
  process.env.AM_TURNS_LOG = dir
  const logger = createTurnLogger()
  const viet = 'Nguyễn Văn A đang kiểm tra 🍕🍔'
  logger.log({
    agent: 'a', task: 't', stage: 's',
    motive: viet,
    action: 'text', outcome: viet.repeat(10), // > 500 → test truncate cắt emoji
    turnCount: 0, token: 0,
  })
  const file = path.join(dir, 'turn-log.jsonl')
  const raw = fs.readFileSync(file, 'utf8')
  let parsed: unknown
  try { parsed = JSON.parse(raw.trim()); check('JSON parse OK', true) }
  catch (e) { check('JSON parse KHÔNG lỗi', false, `lỗi: ${e}`) }
  if (parsed) {
    const p = parsed as Record<string, unknown>
    check('motive chứa tiếng Việt', String(p.motive).includes('Nguyễn'))
    check('outcome không bị JSON-invalid do truncate', typeof p.outcome === 'string')
  }
  delete process.env.AM_TURNS_LOG
  fs.rmSync(dir, { recursive: true, force: true })
}

// ── Test 6: env AM_TURNS_LOG không set → NoopTurnLogger ──
function t6() {
  console.log('\nT6 — AM_TURNS_LOG không set → NoopTurnLogger')
  const old = process.env.AM_TURNS_LOG
  delete process.env.AM_TURNS_LOG
  const logger = createTurnLogger()
  check('logger là NoopTurnLogger', logger instanceof NoopTurnLogger)
  if (old !== undefined) process.env.AM_TURNS_LOG = old
}

// ── Test 7: error tolerance — ghi file lỗi không crash (log() nuốt lỗi) ──
function t7() {
  console.log('\nT7 — error tolerance: appendFileSync lỗi không crash')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-t7-'))
  const old = process.env.AM_TURNS_LOG
  process.env.AM_TURNS_LOG = dir
  const logger = createTurnLogger()
  // tạo 1 thư mục cùng tên với file đích → appendFileSync lỗi EISDIR
  const file = path.join(dir, 'turn-log.jsonl')
  fs.mkdirSync(file)
  let crashed = false
  try {
    logger.log({ agent: 'a', task: 't', stage: 's', motive: 'x', action: 'text', outcome: '', turnCount: 0, token: 0 })
  } catch {
    crashed = true
  }
  check('không crash khi appendFileSync thất bại', !crashed)
  process.env.AM_TURNS_LOG = old
  fs.rmSync(dir, { recursive: true, force: true })
}

// ── Test 8: AM_TURNS_LOG set rỗng → NoopTurnLogger ──
function t8() {
  console.log('\nT8 — AM_TURNS_LOG set rỗng → NoopTurnLogger')
  const old = process.env.AM_TURNS_LOG
  process.env.AM_TURNS_LOG = ''
  const logger = createTurnLogger()
  check('AM_TURNS_LOG="" → NoopTurnLogger', logger instanceof NoopTurnLogger)
  process.env.AM_TURNS_LOG = old
}

// ── Test 9: TurnRecord type — tất cả action types ──
function t9() {
  console.log('\nT9 — Cả 4 action types ghi được')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-t9-'))
  process.env.AM_TURNS_LOG = dir
  const logger = createTurnLogger()
  const actions: TurnRecord['action'][] = ['tool_call', 'text', 'outcome', 'error']
  for (const action of actions) {
    logger.log({ agent: 'a', task: 't', stage: 's', motive: action, action, outcome: action === 'error' ? 'something broke' : '', turnCount: 0, token: 1 })
  }
  const file = path.join(dir, 'turn-log.jsonl')
  const lines = readJSONL(file)
  check('ghi đủ 4 action types', lines.length === 4, `(got ${lines.length})`)
  const actionsLogged = lines.map((l: unknown) => (l as Record<string, unknown>).action)
  check('action types khớp', JSON.stringify(actionsLogged.sort()) === JSON.stringify(actions.sort()))
  delete process.env.AM_TURNS_LOG
  fs.rmSync(dir, { recursive: true, force: true })
}

async function main() {
  console.log('🧪 smoke:turn-log — turn-log.ts unit tests')
  t1(); t2(); t3(); t4(); t5(); t6(); t7(); t8(); t9()
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
