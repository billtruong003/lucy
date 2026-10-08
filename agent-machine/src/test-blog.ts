// INTEGRATION TEST — dự án thật: agent dựng 1 trang blog tĩnh bằng claude THẬT qua kiến trúc này.
// Chạy: CLAUDE_BIN=<path claude.exe> npx tsx src/test-blog.ts
// Guardrail: budget cap $3 + per-card cap $2 -> không cháy token.
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { ClaudeRunner } from './runner'

const dir = path.join(process.cwd(), '.data-test')
fs.rmSync(dir, { recursive: true, force: true })
const store = new Store(dir)

store.registerPersona({
  id: 'builder', name: 'Max · Engineer', model: 'sonnet', allowedTools: ['Read', 'Write', 'Edit', 'Bash'], timeoutSec: 300,
  systemPrompt: 'Bạn là kỹ sư web. Nhiệm vụ: tạo MỘT trang blog TĨNH đơn giản nhưng đẹp & responsive NGAY TRONG thư mục làm việc hiện tại: index.html (trang chủ liệt kê 2 bài), style.css (CSS thuần, gọn, theme tối hiện đại), và post-1.html (1 bài mẫu). KHÔNG framework, KHÔNG cài package. Dùng tool Write tạo file. Làm nhanh gọn, đừng over-engineer.',
})
store.registerPersona({
  id: 'reviewer', name: 'Mei · Reviewer', model: 'sonnet', allowedTools: ['Read', 'Bash'], timeoutSec: 180,
  systemPrompt: 'Bạn review trang blog trong thư mục hiện tại: dùng Read/Bash kiểm index.html + style.css + post-1.html tồn tại, HTML có cấu trúc, CSS được link. Viết nhận xét NGẮN 2-3 câu. Nếu ổn -> outcome advance; thiếu nghiêm trọng -> needs_decision kèm question.',
})
store.registerPipeline({ id: 'blog', name: 'Blog site', stages: [
  { id: 'build', name: 'Dựng trang blog', personaId: 'builder' },
  { id: 'review', name: 'Review', personaId: 'reviewer', gate: true },
] })

const budget = new Budget({ windowMs: 5 * 3600e3, capUsd: 3, softUsd: 2 })
const engine = new Engine(store, new ClaudeRunner(), budget, { maxLanes: 1, perCardMaxUsd: 2, maxStageVisits: 3 })

const card = engine.createCard('Trang blog demo', 'Tạo trang blog tĩnh đơn giản, đẹp, responsive (HTML/CSS thuần): index.html + style.css + 1 bài mẫu.', 'blog', undefined, 0, 'Blog demo')

function listFiles(root: string, base = root): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = path.join(root, e.name)
    if (e.isDirectory()) out.push(...listFiles(p, base))
    else out.push(path.relative(base, p))
  }
  return out
}

async function main() {
  console.log('🧪 INTEGRATION — agent dựng blog bằng claude THẬT (cap $3)\n')
  console.log('▶ build agent đang chạy claude -p (có thể vài phút)...')
  await engine.runUntilIdle()
  let c = store.getCard(card.id)!
  console.log(`   build/review xong → status: ${c.status} · cost $${c.cost.usd.toFixed(4)}`)

  if (c.status === 'waiting_human') {
    console.log('⛔ GATE (review xong) → auto-approve để hoàn tất')
    engine.approve(card.id)
    await engine.runUntilIdle()
    c = store.getCard(card.id)!
  }

  console.log(`\n── KẾT QUẢ ──`)
  console.log(`status: ${c.status} · tổng cost $${c.cost.usd.toFixed(4)} · ${c.cost.inTok}in/${c.cost.outTok}out tok`)

  // files agent tạo
  const ws = card.workspace
  const files = fs.existsSync(ws) ? listFiles(ws).filter((f) => f !== '.persona.md') : []
  console.log(`\nfiles agent tạo trong workspace:`)
  for (const f of files) { const sz = fs.statSync(path.join(ws, f)).size; console.log(`  ${f}  (${sz}b)`) }

  // channel log (outcome agent emit)
  console.log(`\nchannel (agent nói):`)
  for (const m of store.readChannel(`card-${card.id}`)) console.log(`  [${m.author}] ${m.kind === 'handoff' ? '📨' : m.kind === 'report' ? '🏁' : m.kind === 'decision' ? '⛔' : '·'} ${m.text.slice(0, 140)}`)

  // history (engine đọc outcome ra sao)
  console.log(`\nhistory (engine xử lý outcome):`)
  for (const h of c.history) console.log(`  ${h.event}${h.stage !== '-' ? ' · ' + h.stage : ''}${h.detail ? ' — ' + h.detail.slice(0, 80) : ''}`)

  console.log(`\nWS path: ${ws}`)
}
main().catch((e) => { console.error('LỖI:', e); process.exit(1) })
