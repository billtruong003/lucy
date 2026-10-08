// smoke-bitemporal — PHASE 4: forgetting / bi-temporal invalidation (Zep-style).
// Không mạng (embedder + decider GIẢ). Chứng minh:
//  (1) upsertFrontmatterKey chèn/sửa valid_to, GIỮ body + key khác (cả frontmatter nested metadata);
//  (2) recall MẶC ĐỊNH lọc fact có valid_to; includeInvalid → trả lại (lịch sử truy được);
//  (3) consolidate SUPERSEDE → giữ fact MỚI, đánh dấu fact CŨ valid_to (KHÔNG xoá); DRY-RUN không đụng file;
//  (4) GUARD: fact cũ trust cao hơn → KHÔNG tự vô hiệu (NOOP).
//   npm run smoke:bitemporal
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { upsertFrontmatterKey, parseFrontmatter } from './vault'
import { Recall } from './recall'
import { EMBED_DIM, type Embedder } from './embed'
import { planConsolidation, applyPlan, type Decider, type Reflector } from './consolidate'

let fails = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails++
}

// ── (1) upsertFrontmatterKey ──
function testUpsert() {
  const raw = ['---', 'name: foo', 'description: "bar"', 'metadata:', '  type: user', '---', '', 'Body giữ nguyên.', ''].join('\n')
  const added = upsertFrontmatterKey(raw, 'valid_to', '2026-06-14T00:00:00.000Z')
  const p1 = parseFrontmatter(added)
  check('upsert thêm valid_to', p1.data.valid_to === '2026-06-14T00:00:00.000Z', String(p1.data.valid_to))
  check('upsert giữ key cũ', p1.data.name === 'foo' && String(p1.data.description) === 'bar')
  check('upsert giữ body', p1.data && added.includes('Body giữ nguyên.'))
  // sửa lại (idempotent — không nhân đôi dòng)
  const again = upsertFrontmatterKey(added, 'valid_to', '2026-07-01T00:00:00.000Z')
  check('upsert sửa giá trị (không nhân đôi)', (again.match(/valid_to:/g) || []).length === 1 && parseFrontmatter(again).data.valid_to === '2026-07-01T00:00:00.000Z')
  // file không có frontmatter → tạo block
  const fresh = upsertFrontmatterKey('Chỉ body.', 'valid_to', 'X')
  check('upsert tạo frontmatter mới khi thiếu', parseFrontmatter(fresh).data.valid_to === 'X' && fresh.includes('Chỉ body.'))
}

// ── (2) recall lọc valid_to ──
const fact = (name: string, desc: string, body: string, validTo?: string) =>
  ['---', `name: ${name}`, `description: "${desc}"`, ...(validTo ? [`valid_to: ${validTo}`] : []), 'metadata:', '  type: reference', '---', '', body, ''].join('\n')

function testRecallFilter() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-smoke-bitemp-'))
  const md = path.join(root, 'Brain', 'claude-memory')
  fs.mkdirSync(md, { recursive: true })
  fs.writeFileSync(path.join(md, 'rsi-new.md'), fact('rsi-new', 'Ngưỡng RSI BTC hiện tại', 'Ngưỡng RSI BTC chốt 70 (mới).'))
  fs.writeFileSync(path.join(md, 'rsi-old.md'), fact('rsi-old', 'Ngưỡng RSI BTC cũ', 'Ngưỡng RSI BTC cũ 60.', '2026-06-14T00:00:00.000Z'))
  const r = new Recall(root, { vector: false })
  r.reindex({ full: true })
  const def = r.search('RSI BTC ngưỡng', { limit: 10 })
  check('recall mặc định BỎ fact valid_to (chỉ rsi-new)', def.length === 1 && def[0].file_path.includes('rsi-new'), `n=${def.length} files=${def.map((h) => h.file_path).join(',')}`)
  const all = r.search('RSI BTC ngưỡng', { limit: 10, includeInvalid: true })
  check('recall includeInvalid → trả cả 2 (lịch sử)', all.length === 2, `n=${all.length}`)
  const rec = r.recent({ limit: 10 })
  check('recent mặc định cũng bỏ fact hết hiệu lực', rec.every((h) => !h.file_path.includes('rsi-old')))
  r.close()
  fs.rmSync(root, { recursive: true, force: true })
}

// ── (3)+(4) consolidate SUPERSEDE ──
const fakeEmbed: Embedder = async (texts) => texts.map((t) => {
  const f = t.toLowerCase()
  const v = new Array(EMBED_DIM).fill(0)
  if (f.includes('rsi')) v[0] = 1 // mọi fact RSI → vector trùng (sim≈1 ≥ ngưỡng)
  return v
})
// decider giả: 2 fact RSI mâu thuẫn → SUPERSEDE.
const fakeDecider: Decider = async (keep, other) => {
  const both = (keep.body + other.body).toLowerCase()
  if (both.includes('rsi')) return { op: 'SUPERSEDE', reason: 'ngưỡng RSI mâu thuẫn — fact cũ lỗi thời' }
  return { op: 'NOOP', reason: 'khác' }
}
const fakeReflector: Reflector = async () => null

function memFile(md: string, name: string, type: string, body: string, mtime: number) {
  const f = path.join(md, name + '.md')
  fs.writeFileSync(f, ['---', `name: ${name}`, `description: "${name}"`, 'metadata:', `  type: ${type}`, '---', '', body, ''].join('\n'))
  fs.utimesSync(f, new Date(mtime), new Date(mtime))
}

async function testSupersede() {
  // cặp cùng trust → SUPERSEDE giữ MỚI, vô hiệu CŨ
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-smoke-bitemp-c-'))
  const md = path.join(root, 'Brain', 'claude-memory')
  fs.mkdirSync(md, { recursive: true })
  memFile(md, 'rsi-old', 'reference', 'Ngưỡng RSI BTC = 60.', Date.parse('2026-01-01'))
  memFile(md, 'rsi-new', 'reference', 'Ngưỡng RSI BTC = 70.', Date.parse('2026-06-01'))
  fs.writeFileSync(path.join(md, 'MEMORY.md'), ['# Index', '- [old](rsi-old.md)', '- [new](rsi-new.md)'].join('\n'))

  const plan = await planConsolidation(root, { embedder: fakeEmbed, decider: fakeDecider, reflector: fakeReflector })
  const dec = plan.decisions[0]
  check('SUPERSEDE: 1 decision', plan.decisions.length === 1 && dec?.op === 'SUPERSEDE', `dec=${JSON.stringify(plan.decisions.map((d) => d.op))}`)
  check('SUPERSEDE: keep=mới (rsi-new), redundant=cũ (rsi-old)', dec?.keep === 'rsi-new' && dec?.redundant === 'rsi-old')
  check('DRY-RUN: chưa đụng file (rsi-old không có valid_to)', !parseFrontmatter(fs.readFileSync(path.join(md, 'rsi-old.md'), 'utf8')).data.valid_to)

  const res = applyPlan(root, plan, new Date('2026-06-14T00:00:00Z'))
  check('APPLY: invalidated chứa rsi-old', res.invalidated.includes('rsi-old'))
  check('APPLY: rsi-old CÒN file (không xoá)', fs.existsSync(path.join(md, 'rsi-old.md')))
  check('APPLY: rsi-old có valid_to', parseFrontmatter(fs.readFileSync(path.join(md, 'rsi-old.md'), 'utf8')).data.valid_to === '2026-06-14T00:00:00.000Z')
  check('APPLY: rsi-new KHÔNG bị đụng', !parseFrontmatter(fs.readFileSync(path.join(md, 'rsi-new.md'), 'utf8')).data.valid_to)
  check('APPLY: MEMORY.md GIỮ pointer rsi-old (lịch sử)', fs.readFileSync(path.join(md, 'MEMORY.md'), 'utf8').includes('(rsi-old.md)'))
  fs.rmSync(root, { recursive: true, force: true })

  // GUARD: fact CŨ trust CAO hơn (user ×2) vs mới trust thấp → KHÔNG tự vô hiệu
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-smoke-bitemp-g-'))
  const md2 = path.join(root2, 'Brain', 'claude-memory')
  fs.mkdirSync(md2, { recursive: true })
  memFile(md2, 'rsi-bill', 'user', 'Ngưỡng RSI BTC = 60 (chủ nhân chốt).', Date.parse('2026-01-01'))
  memFile(md2, 'rsi-auto', 'reference', 'Ngưỡng RSI BTC = 70 (tự suy).', Date.parse('2026-06-01'))
  const plan2 = await planConsolidation(root2, { embedder: fakeEmbed, decider: fakeDecider, reflector: fakeReflector })
  check('GUARD: fact cũ trust cao → NOOP (không decision)', plan2.decisions.length === 0 && plan2.noops >= 1, `dec=${plan2.decisions.length} noops=${plan2.noops}`)
  fs.rmSync(root2, { recursive: true, force: true })
}

async function main() {
  testUpsert()
  testRecallFilter()
  await testSupersede()
  console.log(fails ? `\n❌ ${fails} fail` : '\n✅ smoke-bitemporal PASS')
  process.exit(fails ? 1 : 0)
}
main()
