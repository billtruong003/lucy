// smoke-memory — verify TOÀN BỘ memory stack (A1→A7) bằng chạy thật trên vault tạm.
//   npm run smoke:memory          # phần bootstrap/distill cần claude CLI; không có → skip phần đó
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Recall } from './recall'
import { dream } from './dream'
import { writeSignal } from './signal'
import { writeSessionNote } from './session-note'
import type { Card } from './types'

let fails = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails++
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-smoke-mem-'))
const V = path.join(root, 'vault')
for (const d of ['Context', 'Projects', 'Daily', 'Brain/inbox', 'Brain/preferences', 'Brain/log', 'Brain/claude-memory']) {
  fs.mkdirSync(path.join(V, d), { recursive: true })
}

// ── vault mẫu: 3 note có wikilink + dấu tiếng Việt ──
fs.writeFileSync(path.join(V, 'Context/USER.md'), [
  '---', 'title: Bill — chủ nhân', 'type: person', 'permalink: user-bill', 'tags: [user]', '---', '',
  '# Bill', '- [identity] Bill là technical artist mê gamedev #user', '- chủ_của [[project-radiant]]', '',
].join('\n'))
fs.writeFileSync(path.join(V, 'Projects/radiant.md'), [
  '---', 'title: Radiant — dự án', 'type: project', 'permalink: project-radiant', '---', '',
  '# Radiant', '- [stack] Discord bot chạy HMAC x-lucy-signature', '',
].join('\n'))
fs.writeFileSync(path.join(V, 'Context/LUCY.md'), [
  '---', 'title: Lucy — danh tính', 'type: identity', 'permalink: lucy-identity', '---', '',
  '# Lucy', '- [identity] trợ lý cá nhân memory-first', '- phục_vụ [[user-bill]]', '',
].join('\n'))

// ════ A5/A6/A7: recall ════
const r = new Recall(V)
const st = r.reindex()
check('reindex 3 note', st.total === 3, `total=${st.total}`)

// A6 trigram: substring giữa từ ("medev" nằm trong "gamedev") — FTS từ-nguyên thường chịu chết
const triHits = r.search('medev')
check('A6 trigram substring "medev" → gamedev', triHits.length > 0 && !!triHits[0].tri, JSON.stringify(triHits[0]?.title || 'MISS'))
// A6 substring mã/kỹ thuật: "ucy-signat" trong "x-lucy-signature" (1 token → không bị relaxed-OR đớp trước)
const triHits2 = r.search('ucy-signat')
check('A6 trigram "ucy-signat" → x-lucy-signature', triHits2.length > 0 && !!triHits2[0].tri, triHits2[0]?.title || 'MISS')

// A5 bump: search 2 lần trúng USER.md → recall_count ≥ 2
r.search('technical artist'); r.search('technical artist')
const db = (r as any).db
const rc = db.prepare("SELECT recall_count FROM note WHERE permalink='user-bill'").get() as { recall_count: number }
check('A5 recall_count bump (2 lần search trúng)', rc.recall_count >= 2, `count=${rc.recall_count}`)

// A7 graph-walk: hit USER.md → kéo theo project-radiant (chiều ra) + lucy-identity (chiều vào)
const hits = r.search('technical artist')
const rel = r.related(hits.map((h) => h.file_path))
const relPerma = rel.map((x) => x.permalink).sort()
check('A7 related 2 chiều (ra: project-radiant · vào: lucy-identity)',
  relPerma.includes('project-radiant') && relPerma.includes('lucy-identity'), relPerma.join(', '))
r.close()

// ════ trust-weight: 1 signal agent=bill (×2) đủ ngưỡng 2 → graduate NGAY ════
writeSignal(V, { topic: 'lucy/bao-cao-ngan', signal: 'positive', principle: 'báo cáo ngắn gọn 3 dòng', cardId: 'c1', agent: 'bill' })
const d1 = dream(V)
check('trust-weight: 1 signal bill → graduate ngay', d1.graduated.length === 1, d1.graduated.join(','))
// signal máy (×1) thì 1 cái KHÔNG được graduate
writeSignal(V, { topic: 'lucy/may-mot-cai', signal: 'negative', principle: 'signal máy 1 cái phải chờ', cardId: 'c2', agent: 'engine' })
const d2 = dream(V)
check('trust-weight: 1 signal engine → CHƯA graduate (chờ lặp)', d2.graduated.length === 0, `graduated=${d2.graduated.length}`)

// ════ A3 session-note ════
const card: Card = {
  id: 'card_a3', title: 'Build endpoint metrics', projectId: 'radiant',
  brief: 'Expose Prometheus metrics.', pipelineId: 'p', stageIndex: 1, status: 'done', workspace: '',
  depth: 0, blockedBy: [], reviewNotes: ['nhớ đọc env'], lastSummary: 'metrics OK, curl 200, 14 metric',
  artifacts: { files: ['src/metrics.ts', 'src/env.ts'] },
  cost: { usd: 0.21, inTok: 9, outTok: 9 }, createdAt: Date.now() - 8 * 60000, updatedAt: Date.now(),
  history: [{ ts: Date.now() - 60000, stage: 's1', event: 'advance' }, { ts: Date.now(), stage: 's2', event: 'done' }],
}
const noteFile = writeSessionNote(V, card)
const noteRaw = noteFile ? fs.readFileSync(noteFile, 'utf8') : ''
check('A3 session-note ghi Daily/ + temporal anchor + goal/done/files',
  !!noteFile && noteRaw.includes('QUÁ KHỨ') && noteRaw.includes('- [goal]') && noteRaw.includes('- [done]') && noteRaw.includes('src/metrics.ts'),
  noteFile ? path.basename(noteFile) : 'null')
// session-note phải recallable (Daily nằm trong INDEX_DIRS)
const r2 = new Recall(V)
r2.reindex()
const sHits = r2.search('curl 200 metric')
check('A3 session-note recallable', sHits.some((h) => h.permalink === 'session-card_a3'), sHits[0]?.permalink || 'MISS')
r2.close()

// ════ bootstrap (claude thật — không có CLI thì skip) ════
fs.writeFileSync(path.join(V, 'Brain/claude-memory/secret-handling.md'), [
  '---', 'name: secret-handling', 'description: không đọc secret ra chat', '---', '',
  'Quy tắc: secret/key/token tuyệt đối không echo ra chat, không log.', '',
].join('\n'))
fs.writeFileSync(path.join(V, 'Brain/claude-memory/MEMORY.md'), '# index\n- [secret-handling](secret-handling.md)\n')
const { bootstrapFromMemory } = await import('./bootstrap')
const b = await bootstrapFromMemory(V)
if (!b.sigs.length) {
  console.log('⚠️ bootstrap SKIP — claude không trả quy tắc (CLI thiếu / API hiccup). Verify tay: LUCY_VAULT=<vault> npm run bootstrap')
} else {
  for (const s of b.sigs) console.log(`   + [${s.signal}] ${s.topic} :: ${s.principle}`)
  check('bootstrap: ký ức secret-handling → graduate preference', (b.dream?.graduated.length ?? 0) >= 1, b.dream?.graduated.join(', ') || '(0)')
}

fs.rmSync(root, { recursive: true, force: true })
console.log(fails ? `\n❌ smoke-memory FAIL (${fails})` : '\n✅ smoke-memory PASS toàn bộ (vault tạm đã dọn)')
process.exit(fails ? 1 : 0)
