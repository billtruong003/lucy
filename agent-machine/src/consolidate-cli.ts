// consolidate-cli — PHASE 3: chạy "gộp trí nhớ" tay/cron. MẶC ĐỊNH DRY-RUN (chỉ in diff + ghi report).
// Ghi đè/xoá file thật CHỈ khi LUCY_CONSOLIDATE_APPLY=1 (snapshot trước).
//   LUCY_VAULT=~/lucy/lucy-vault npm run consolidate          # dry-run
//   LUCY_VAULT=... LUCY_CONSOLIDATE_APPLY=1 npm run consolidate # áp thật (sau khi xem diff)
import fs from 'node:fs'
import path from 'node:path'
import { planConsolidation, renderPlan, applyPlan, consolidateApplyOn, vectorFlagOn } from './consolidate'

async function main() {
  const vault = process.env.LUCY_VAULT || path.resolve(process.cwd(), '..', 'lucy-vault')
  if (!fs.existsSync(vault)) { console.error(`❌ LUCY_VAULT không tồn tại: ${vault}`); process.exit(1) }
  if (!vectorFlagOn()) { console.error('❌ vector tắt (cần JINA_API_KEY + LUCY_VECTOR≠0) — consolidate cần embedding để so similarity'); process.exit(1) }

  const now = new Date()
  console.log(`🧪 consolidate (${consolidateApplyOn() ? 'APPLY — sẽ ghi thật' : 'DRY-RUN — không đụng file'}) trên ${vault}`)
  const plan = await planConsolidation(vault)

  if (consolidateApplyOn() && (plan.decisions.length || plan.reflections.length)) {
    const res = applyPlan(vault, plan, now)
    console.log(`✅ đã áp: xoá ${res.deleted.length} · cập nhật ${res.updated.length} · vô hiệu ${res.invalidated.length} · snapshot ${res.snapshot || '(lỗi)'}`)
  }

  const report = renderPlan(plan)
  console.log('\n' + report)

  // ghi report (additive, an toàn cả dry-run) → Brain/proposals/consolidate-<date>.md
  try {
    const dir = path.join(vault, 'Brain', 'proposals')
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, `consolidate-${now.toISOString().slice(0, 10)}.md`)
    fs.writeFileSync(f, `---\ntitle: Consolidation report ${now.toISOString().slice(0, 10)}\ndate: ${now.toISOString()}\nkind: consolidate-report\napplied: ${plan.applied}\n---\n\n${report}\n`)
    console.log(`\n📄 report: ${f}`)
  } catch { /* report lỗi không chặn */ }
}
main().catch((e) => { console.error('consolidate lỗi:', e); process.exit(1) })
