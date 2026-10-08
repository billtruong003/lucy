// smoke-memory-e2e.ts — TEST GUIDE trí nhớ tự động (thay test tay).
// 4 kịch bản như docs/TEST-GUIDE-MEMORY.md, chạy trên Recall + vault THẬT (read-only cho recall;
// episodic dùng sentinel rồi tự dọn). Cần mạng cho test cross-lingual (vector) — không key thì SKIP có ghi chú.
//   chạy: npm run smoke:memory-e2e
import Database from 'better-sqlite3'
import path from 'node:path'
import os from 'node:os'
import { Recall } from './recall'
import { vectorFlagOn } from './embed'
import { scrubSecrets } from './redact'

const VAULT = process.env.LUCY_VAULT || path.join(os.homedir(), 'lucy', 'lucy-vault')
let pass = 0, fail = 0, skip = 0
const ok = (c: boolean, name: string, detail = '') => { if (c) { pass++; console.log(`✅ ${name}`) } else { fail++; console.log(`❌ ${name} ${detail}`) } }
const sk = (name: string, why: string) => { skip++; console.log(`⏭️  ${name} — SKIP: ${why}`) }
const hay = (hits: { title?: string; file_path?: string; snippet?: string }[], needle: string) =>
  hits.some((h) => `${h.title || ''} ${h.file_path || ''} ${h.snippet || ''}`.toLowerCase().includes(needle.toLowerCase()))

async function main() {
  const r = new Recall(VAULT)
  r.reindex() // incremental, rẻ

  // TEST 1 — recall xuyên phiên (tìm hồ sơ chủ nhân bằng tiếng Việt)
  const h1 = await r.hybridSearch('chủ nhân là ai làm nghề gì', { limit: 5 })
  ok(h1.length > 0 && (hay(h1, 'owner') || hay(h1, 'bill') || hay(h1, 'truong')),
    'TEST1 recall xuyên phiên: hỏi nghề chủ nhân → kéo note hồ sơ', `(hits=${h1.map(h => h.title || h.file_path).join(',')})`)

  // TEST 2 — vector cross-lingual (EN query → note tiếng Việt). Cần vector bật.
  if (vectorFlagOn()) {
    const h2 = await r.hybridSearch('who is the game developer owner', { limit: 5 })
    ok(h2.length > 0 && (hay(h2, 'owner') || hay(h2, 'bill') || hay(h2, 'truong')),
      'TEST2 vector cross-lingual: EN query → note owner tiếng Việt', `(hits=${h2.map(h => h.title || h.file_path).join(',')})`)
  } else sk('TEST2 vector cross-lingual', 'LUCY_VECTOR off / không có JINA_API_KEY')

  // TEST 3 — episodic round-trip (ghi turn sentinel → tìm lại → tự dọn)
  const marker = 'E2E_SENTINEL_zzx_' + (process.env.SMOKE_TAG || 'run')
  const id = r.recordTurn({ source: 'smoke', chatId: 'e2e', role: 'user', content: `ghi nhớ test ${marker} embedding v5 omni nano` })
  const found = r.searchTurns(marker, { limit: 5 })
  ok(!!id && found.length > 0, 'TEST3 episodic: ghi turn → searchTurns kéo lại đúng', `(id=${id}, found=${found.length})`)
  // dọn sentinel khỏi DB live
  try {
    const db = new Database(path.join(VAULT, '.index', 'memory.db'))
    const del = db.prepare("DELETE FROM turns WHERE content LIKE ?").run(`%${marker}%`)
    try { db.exec("INSERT INTO turns_fts(turns_fts) VALUES('rebuild')") } catch { /* */ }
    db.close()
    console.log(`   ↳ dọn ${del.changes} turn sentinel`)
  } catch (e) { console.log('   ↳ cảnh báo dọn sentinel:', (e as Error).message) }

  // TEST 4 — redaction (secret KHÔNG lọt nguyên si)
  const secrets = [
    'key giả sk-ABC123def456ghi789jklmno đừng nhớ',
    'jina_FAKEFAKEFAKEFAKEFAKEFAKEFAKE0000',
    'authorization: Bearer ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345',
  ]
  let leak = false
  for (const s of secrets) {
    const red = scrubSecrets(s)
    // các token nhạy cảm gốc không còn nguyên trong output
    if (red.includes('sk-ABC123def456ghi789jklmno') || red.includes('jina_FAKEFAKEFAKEFAKEFAKEFAKEFAKE0000') || red.includes('ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345')) leak = true
  }
  ok(!leak, 'TEST4 redaction: secret bị scrub [REDACTED], không lọt nguyên si')

  r.close()
  console.log(`\n— Kết quả: ${pass} pass, ${fail} fail, ${skip} skip —`)
  if (fail > 0) process.exit(1)
}
main().catch((e) => { console.error('E2E lỗi:', e); process.exit(1) })
