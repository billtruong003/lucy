// smoke-consolidate — PHASE 3: verify gộp trí nhớ Mem0-style.
// Embedder + decider + reflector GIẢ (không mạng). Chứng minh: (1) cặp gần-trùng → DELETE; fact khác → NOOP;
// (2) DRY-RUN KHÔNG đụng file thật; (3) APPLY xoá file + dọn pointer MEMORY.md + tạo snapshot; (4) trust-weight giữ bản tin cậy.
//   npm run smoke:consolidate
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EMBED_DIM, type Embedder } from './embed'
import { planConsolidation, applyPlan, loadFacts, parseDecision, type Decider, type Reflector } from './consolidate'

let fails = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails++
}

// concept-bag embedder: fact cùng concept → vector gần trùng (cosine≈1).
const CONCEPTS: string[][] = [
  ['bridge', 'telegram', 'hermes', 'replace'],
  ['rsi', 'btc', 'bitcoin', 'nguong', 'threshold'],
  ['unity', 'shader', 'gamedev', 'game'],
]
const fakeEmbed: Embedder = async (texts) => texts.map((t) => {
  const f = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
  const v = new Array(EMBED_DIM).fill(0)
  CONCEPTS.forEach((syns, dim) => { if (syns.some((s) => f.includes(s))) v[dim] = 1 })
  return v
})
// decider giả: nếu 2 fact cùng concept "bridge" → DELETE bản redundant; còn lại NOOP.
const fakeDecider: Decider = async (keep, other) => {
  const both = (keep.body + other.body + keep.name + other.name).toLowerCase()
  if (both.includes('bridge') && both.includes('hermes')) return { op: 'DELETE', reason: 'trùng — bridge đã thay hermes' }
  return { op: 'NOOP', reason: 'khác nhau' }
}
const fakeReflector: Reflector = async () => null

const mem = (name: string, type: string, desc: string, body: string) =>
  ['---', `name: ${name}`, `description: "${desc}"`, 'metadata:', `  type: ${type}`, '---', '', body, ''].join('\n')

function setupVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-smoke-consol-'))
  const md = path.join(root, 'Brain', 'claude-memory')
  fs.mkdirSync(md, { recursive: true })
  // 2 fact gần-trùng (cùng concept bridge/hermes) — bản A type=project (trust1), B type=user (trust2 → GIỮ B).
  fs.writeFileSync(path.join(md, 'bridge-old.md'), mem('bridge-old', 'project', 'Lucy là bridge thay Hermes', 'Lucy = Telegram bridge thay Hermes, Hermes đã stop.'))
  fs.writeFileSync(path.join(md, 'bridge-new.md'), mem('bridge-new', 'user', 'Bridge Telegram thay Hermes (bản mới)', 'Telegram bridge thay Hermes hoàn toàn, Hermes disabled.'))
  // 1 fact khác hẳn → phải NOOP, không bị đụng.
  fs.writeFileSync(path.join(md, 'btc-rsi.md'), mem('btc-rsi', 'reference', 'Ngưỡng RSI BTC', 'Ngưỡng RSI bitcoin chốt 70.'))
  fs.writeFileSync(path.join(md, 'MEMORY.md'), [
    '# Memory Index', '',
    '- [Bridge old](bridge-old.md) — cũ',
    '- [Bridge new](bridge-new.md) — mới',
    '- [BTC RSI](btc-rsi.md) — ngưỡng',
  ].join('\n'))
  return root
}

async function main() {
  // parseDecision robustness
  check('parseDecision DELETE', parseDecision('{"op":"DELETE","reason":"x"}').op === 'DELETE')
  check('parseDecision UPDATE thiếu merged → NOOP', parseDecision('{"op":"UPDATE","reason":"x"}').op === 'NOOP')
  check('parseDecision rác → NOOP', parseDecision('không phải json').op === 'NOOP')
  check('parseDecision envelope result', parseDecision(JSON.stringify({ result: '{"op":"DELETE","reason":"y"}' })).op === 'DELETE')

  const V = setupVault()
  check('loadFacts đọc 3 fact (bỏ MEMORY.md)', loadFacts(V).length === 3, `n=${loadFacts(V).length}`)
  check('trust-weight: type=user ×2', (loadFacts(V).find((f) => f.name === 'bridge-new')?.trust) === 2)

  // ── DRY-RUN: dựng plan, KHÔNG đụng file ──
  const plan = await planConsolidation(V, { embedder: fakeEmbed, decider: fakeDecider, reflector: fakeReflector })
  check('plan có đúng 1 DELETE (cặp bridge)', plan.decisions.length === 1 && plan.decisions[0].op === 'DELETE', `dec=${JSON.stringify(plan.decisions.map((d) => d.op))}`)
  check('keeper = bản trust cao (bridge-new), redundant = bridge-old', plan.decisions[0]?.keep === 'bridge-new' && plan.decisions[0]?.redundant === 'bridge-old')
  check('btc-rsi KHÔNG bị đụng (không vào decisions)', !plan.decisions.some((d) => d.keep === 'btc-rsi' || d.redundant === 'btc-rsi'))
  check('DRY-RUN: 3 file vẫn còn nguyên', fs.existsSync(path.join(V, 'Brain/claude-memory/bridge-old.md')))
  check('DRY-RUN: plan.applied=false', plan.applied === false)

  // ── APPLY: xoá redundant + dọn pointer + snapshot ──
  const res = applyPlan(V, plan, new Date('2026-06-14T00:00:00Z'))
  check('APPLY xoá bridge-old', res.deleted.includes('bridge-old') && !fs.existsSync(path.join(V, 'Brain/claude-memory/bridge-old.md')))
  check('APPLY giữ bridge-new + btc-rsi', fs.existsSync(path.join(V, 'Brain/claude-memory/bridge-new.md')) && fs.existsSync(path.join(V, 'Brain/claude-memory/btc-rsi.md')))
  const idx = fs.readFileSync(path.join(V, 'Brain/claude-memory/MEMORY.md'), 'utf8')
  check('APPLY dọn pointer bridge-old khỏi MEMORY.md', !idx.includes('(bridge-old.md)') && idx.includes('(bridge-new.md)'))
  check('APPLY tạo snapshot', !!res.snapshot && fs.existsSync(res.snapshot))
  check('APPLY: plan.applied=true', plan.applied === true)

  fs.rmSync(V, { recursive: true, force: true })
  console.log(fails ? `\n❌ ${fails} fail` : '\n✅ smoke-consolidate PASS')
  process.exit(fails ? 1 : 0)
}
main()
