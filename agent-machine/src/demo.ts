// Demo walking-skeleton — chứng minh loop end-to-end bằng MockRunner (KHÔNG đốt token).
// Kịch bản đúng ví dụ portal của Bill: content soạn course -> STUCK web không render
// -> delegate sang engineer -> HOLD -> engineer xong -> RESUME -> review (GATE) -> Bill duyệt -> ship -> DONE.
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import type { Outcome } from './types'

const dir = path.join(process.cwd(), '.data-demo')
fs.rmSync(dir, { recursive: true, force: true }) // reset cho chạy lại sạch

const store = new Store(dir)

// ── CONFIG (data) — personas + pipelines. Thực tế Lucy tự ghi từ prompt+ảnh. ──
store.registerPersona({ id: 'writer', name: 'Aria · Writer', systemPrompt: 'Viết nội dung khoá học HTML/CSS/Vue.', model: 'sonnet' })
store.registerPersona({ id: 'engineer', name: 'Max · Engineer', systemPrompt: 'Fix code / render web.', model: 'sonnet', allowedTools: ['Read', 'Write', 'Edit', 'Bash'] })
store.registerPersona({ id: 'reviewer', name: 'Mei · Reviewer', systemPrompt: 'Review chất lượng & tag.', model: 'opus' })

store.registerPipeline({ id: 'course', name: 'Portal course', stages: [
  { id: 'draft', name: 'Soạn nội dung course', personaId: 'writer' },
  { id: 'review', name: 'Review & test', personaId: 'reviewer', gate: true }, // GATE: Bill check
  { id: 'ship', name: 'Xuất bản', personaId: 'writer' },
] })
store.registerPipeline({ id: 'eng', name: 'Engineer subtask', stages: [
  { id: 'fix', name: 'Fix render web', personaId: 'engineer' },
] })

// ── Kịch bản MockRunner (outcome theo stage.id) ──
const script: Record<string, Outcome> = {
  draft: { decision: 'delegate', summary: 'Đang giã docs HTML/CSS/Vue — STUCK: web không render, nhờ engineer', delegateTo: { personaId: 'engineer', title: 'Fix render web cho course', brief: 'Web không render, fix giúp content.', pipelineId: 'eng' } },
  fix: { decision: 'done', summary: 'Đã fix render (component + build). Functional ✓' },
  review: { decision: 'advance', summary: 'Review xong, mọi tag functional — chờ Bill mark OK' },
  ship: { decision: 'advance', summary: 'Đã xuất bản course lên portal' },
}

const budget = new Budget({ windowMs: 5 * 3600 * 1000, capUsd: 5.0, softUsd: 3.0, weeklyMs: 7 * 24 * 3600 * 1000, weeklyCapUsd: 40 }) // cửa 5h + tuần
const engine = new Engine(store, new MockRunner(script), budget, { maxLanes: 3, perCardMaxUsd: 5, maxStageVisits: 5 })

function dump(tag: string) {
  console.log(`\n──────── ${tag} ────────`)
  for (const c of store.listCards()) {
    const pipe = store.pipelines.get(c.pipelineId)!
    const stage = pipe.stages[c.stageIndex]?.name ?? '-'
    console.log(`  [${c.status.toUpperCase().padEnd(13)}] ${c.title}  ·  stage: ${stage}  ·  $${c.cost.usd.toFixed(3)}` + (c.blockedBy.length ? `  ⛓ blocked-by ${c.blockedBy.join(',')}` : ''))
  }
}

async function main() {
  console.log('🧠 Lucy Agent Machine — walking skeleton (MockRunner, không đốt token)\n')
  const card = engine.createCard('Course: HTML cơ bản', 'Viết course HTML + feature render web demo.', 'course')

  await engine.runUntilIdle()
  dump('Chạy tự động tới khi kẹt GATE')

  const blocked = store.listCards().find((c) => c.status === 'waiting_human')
  if (blocked) {
    console.log(`\n  ⛔ "${blocked.title}" đang chờ NGƯỜI: ${blocked.pendingQuestion}`)
    console.log('  👤 Bill check → mark OK (approve)...')
    engine.approve(blocked.id)
    await engine.runUntilIdle()
  }
  dump('Sau khi Bill duyệt')

  // ── Channel log (Bill đọc cái này trong tab Channels) ──
  console.log('\n──────── CHANNELS (Bill đọc/điều khiển) ────────')
  for (const m of store.readChannel()) {
    const t = new Date(m.ts).toISOString().slice(11, 19)
    console.log(`  ${t} #${m.channel.padEnd(14)} ${m.author.padEnd(14)} ${m.kind === 'decision' ? '⛔' : m.kind === 'report' ? '🏁' : '·'} ${m.text}`)
  }

  // ── Ledger + budget (guardrail token) ──
  const used = budget.usedInWindow()
  console.log(`\n──────── BUDGET (guardrail) ────────`)
  console.log(`  Đã dùng trong cửa 5h: $${used.toFixed(4)} / cap $${budget.cfg.capUsd}  (${budget.check().ok ? 'OK, chưa pause' : 'PAUSED'})`)

  const main2 = store.listCards().find((c) => c.pipelineId === 'course')!
  console.log(`\n✅ Loop OK: delegate→hold→resume→GATE→approve→done.  Card chính: ${main2.status.toUpperCase()}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
