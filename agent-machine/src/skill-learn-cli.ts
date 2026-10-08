#!/usr/bin/env node
// skill-learn-cli.ts — M3.3/M3.6 thủ công.
//   npx tsx src/skill-learn-cli.ts                 → in overview (active + proposed)
//   npx tsx src/skill-learn-cli.ts --card <cardId> → đề xuất skill từ card (DRY-RUN trừ khi LUCY_SKILL_LEARN=1)
// AN TOÀN: dry-run mặc định; ghi (nếu bật) chỉ vào skills/_proposed/ — KHÔNG auto-active.
import path from 'node:path'
import { Store } from './store'
import { skillsOverview } from './skill-loader'
import { proposeSkillFrom, skillLearnFlagOn } from './skill-learn'

async function main() {
  const args = process.argv.slice(2)
  const ci = args.indexOf('--card')
  const cardId = ci !== -1 ? args[ci + 1] : undefined

  if (!cardId) {
    const ov = skillsOverview()
    console.log(`Skills dir: ${ov.skillsDir}`)
    console.log(`LUCY_SKILL_LEARN: ${ov.learnOn ? 'ON (ghi đề xuất)' : 'OFF (dry-run)'}`)
    console.log(`\nActive (INDEX.md): ${ov.activeCount}`)
    console.log(`Proposed (_proposed/, CHƯA active): ${ov.proposedCount}`)
    for (const s of ov.proposed) console.log(`  • ${s.name} — ${s.description}`)
    process.exit(0)
  }

  const dataDir = process.env.AM_DATA ?? path.join(process.cwd(), '.data')
  const store = new Store(dataDir)
  const card = store.cards.get(cardId)
  if (!card) { console.error(`Không thấy card '${cardId}'`); process.exit(1) }

  console.log(`Đề xuất skill từ card '${cardId}' (${skillLearnFlagOn() ? 'APPLY' : 'DRY-RUN'})…`)
  const r = await proposeSkillFrom(card)
  console.log(JSON.stringify({ proposed: r.proposed, wrote: r.wrote, dryRun: r.dryRun, reason: r.reason, slug: r.slug, path: r.path }, null, 2))
  if (r.proposal) console.log(`\nĐề xuất: ${r.proposal.name}\n  ${r.proposal.description}\n  bước: ${r.proposal.steps.length}`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(0) })
