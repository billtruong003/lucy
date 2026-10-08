// dream-cli — chạy "gộp đêm" tay/cron. LUCY_VAULT trỏ tới lucy-vault.
//   npm run dream            # gộp signal → preference (regen active.md) + đúc kết não nghề per-agent (C4)
import fs from 'node:fs'
import path from 'node:path'
import { dream } from './dream'
import { consolidateAllAgentBrainsSafe } from './agent-brain-dream'
import { curateAllAgentBrains } from './agent-brain'
import { planConsolidation, renderPlan, applyPlan, consolidateApplyOn, vectorFlagOn } from './consolidate'

const vault = process.env.LUCY_VAULT || path.resolve(process.cwd(), '..', 'lucy-vault')
process.env.LUCY_VAULT = vault // agent-brain-dream đọc vault qua env → đảm bảo set
const s = dream(vault)
if (!s.changed && !s.contradictions.length) {
  console.log(`😴 dream: không có gì mới (no-op). ${s.activePrefs} preference đang sống.`)
} else {
  console.log('🌙 dream xong:')
  if (s.graduated.length) console.log(`  + graduate ${s.graduated.length} pref mới (unconfirmed): ${s.graduated.join(', ')}`)
  if (s.confirmed.length) console.log(`  ✓ confirmed ${s.confirmed.length}: ${s.confirmed.join(', ')}`)
  if (s.redundant) console.log(`  ~ ${s.redundant} signal trùng (noted-redundant)`)
  if (s.rebutted.length) console.log(`  ✗ rebutted ${s.rebutted.length}: ${s.rebutted.join(', ')}`)
  if (s.retired.length) console.log(`  ⌫ retire ${s.retired.length}: ${s.retired.join(', ')}`)
  if (s.contradictions.length) console.log(`  ⁇ mâu thuẫn (chờ thêm tín hiệu): ${s.contradictions.join(', ')}`)
  if (s.expiredSignals) console.log(`  🧹 dọn ${s.expiredSignals} signal quá hạn (inbox hygiene)`)
  console.log(`  → ${s.processedSignals} signal đã xử lý · ${s.activePrefs} preference đang sống`)
}

// C4: đúc kết não nghề từng agent (gộp bài thô → rule class-level). Async, fire-safe — không có claude/vault = no-op.
consolidateAllAgentBrainsSafe()
  .then((done) => {
    if (done.length) console.log(`🧠 đúc kết não nghề: ${done.map((d) => `${d.personaId} (${d.before}→${d.after})`).join(', ')}`)
    // C4 curator: sau đúc kết, dọn bài thô cũ tràn → archive (deterministic, no-LLM).
    try {
      const curated = curateAllAgentBrains()
      if (curated.length) console.log(`🧹 curate não nghề: ${curated.map((c) => `${c.personaId} (archive ${c.archived})`).join(', ')}`)
    } catch { /* curate hỏng không gãy dream */ }
  })
  .catch(() => { /* nuốt — đúc kết hỏng không được làm gãy dream */ })

// PHASE 3: gộp trí nhớ (claude-memory) Mem0-style + reflection. GATED LUCY_CONSOLIDATE=1 (mặc định TẮT để
// cron khỏi tự đốt token). LUÔN dry-run (in diff + ghi report); ghi thật chỉ khi LUCY_CONSOLIDATE_APPLY=1.
// Fire-safe: cần JINA key (vector) + không có thì no-op, mọi lỗi nuốt — KHÔNG làm gãy dream.
if (process.env.LUCY_CONSOLIDATE === '1' && vectorFlagOn()) {
  const now = new Date()
  planConsolidation(vault)
    .then((plan) => {
      if (consolidateApplyOn() && (plan.decisions.length || plan.reflections.length)) {
        const res = applyPlan(vault, plan, now)
        console.log(`🔗 consolidate ÁP: xoá ${res.deleted.length} · cập nhật ${res.updated.length} · snapshot ${res.snapshot ? 'ok' : 'lỗi'}`)
      } else if (plan.decisions.length || plan.reflections.length) {
        console.log(`🔗 consolidate (DRY-RUN): ${plan.decisions.length} hành động + ${plan.reflections.length} insight đề xuất — xem report`)
      }
      try {
        const dir = path.join(vault, 'Brain', 'proposals')
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, `consolidate-${now.toISOString().slice(0, 10)}.md`),
          `---\ntitle: Consolidation report ${now.toISOString().slice(0, 10)}\ndate: ${now.toISOString()}\nkind: consolidate-report\napplied: ${plan.applied}\n---\n\n${renderPlan(plan)}\n`)
      } catch { /* report lỗi không chặn */ }
    })
    .catch(() => { /* nuốt — consolidate hỏng không gãy dream */ })
}
