// Smoke — M3.3 self-improve (skill-learn) + M3.6 skillsOverview.
// KHÔNG spawn model: inject fake drafter. Chứng minh:
//   • DRY-RUN mặc định KHÔNG ghi đĩa
//   • LUCY_SKILL_LEARN/apply=true → ghi skills/_proposed/<slug>/SKILL.md (status: proposed, KHÔNG vào INDEX)
//   • reusable=false / drafter null → không đề xuất
//   • parseProposal bóc JSON trong fence ```json
//   • slugify bỏ dấu tiếng Việt
//   • skillsOverview liệt kê proposed + KHÔNG nhầm là active

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  proposeSkillFrom, parseProposal, slugify, buildProposalPrompt, type Drafter,
} from './skill-learn'
import { skillsOverview } from './skill-loader'
import type { Card } from './types'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

function makeCard(): Card {
  return {
    id: 'c-learn', pipelineId: 'p', projectId: 'proj', stageIndex: 0,
    title: 'Thêm endpoint coordinator /skills', brief: 'expose skill overview ra hub',
    lastSummary: 'thêm route /skills coordinator + proxy /api/skills + api.ts + tab UI, tsc+smoke sạch',
    status: 'done', workspace: '/tmp', blockedBy: [], depth: 0,
    history: [], cost: { usd: 0, inTok: 0, outTok: 0 }, createdAt: 0, updatedAt: 0,
    artifacts: { files: ['src/coordinator.ts', 'hub/server/src/index.ts'] },
  } as Card
}

const GOOD_JSON = '```json\n{"reusable": true, "name": "Add Coordinator Endpoint", "description": "Thêm route coordinator + proxy hub + api + UI.", "tags": ["coordinator","hub","api"], "steps": ["thêm route", "proxy hub", "api.ts client", "UI tab"]}\n```'
const goodDrafter: Drafter = async () => GOOD_JSON
const refuseDrafter: Drafter = async () => '{"reusable": false, "name":"", "description":"", "tags":[], "steps":[]}'
const nullDrafter: Drafter = async () => null

const NOW = '2026-06-15T00:00:00.000Z'

;(async () => {
  // ── parse + slug unit ──
  console.log('=== Unit: parseProposal + slugify ===')
  const p = parseProposal(GOOD_JSON)
  assert('parse JSON trong fence ```json', !!p && p.name === 'Add Coordinator Endpoint', JSON.stringify(p))
  assert('parse steps đủ 4', !!p && p.steps.length === 4)
  assert('reusable=false → null', parseProposal('{"reusable":false}') === null)
  assert('rác → null', parseProposal('không có json ở đây') === null)
  assert('slugify bỏ dấu + kebab', slugify('Triển khai Đẩy Báo Cáo') === 'trien-khai-day-bao-cao', slugify('Triển khai Đẩy Báo Cáo'))
  assert('buildProposalPrompt có tiêu đề card', buildProposalPrompt(makeCard()).includes('/skills'))

  // ── DRY-RUN (mặc định, không apply) → KHÔNG ghi ──
  console.log('\n=== A: DRY-RUN không ghi đĩa ===')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-learn-'))
  const proposedDir = path.join(tmp, '_proposed')
  const dry = await proposeSkillFrom(makeCard(), { drafter: goodDrafter, apply: false, now: NOW, proposedDir })
  assert('dry: proposed=true', dry.proposed === true, dry.reason)
  assert('dry: wrote=false', dry.wrote === false)
  assert('dry: dryRun=true', dry.dryRun === true)
  assert('dry: KHÔNG tạo file', !fs.existsSync(proposedDir))
  assert('dry: slug đúng', dry.slug === 'add-coordinator-endpoint', dry.slug)

  // ── APPLY → ghi file proposed ──
  console.log('\n=== B: apply=true → ghi _proposed/<slug>/SKILL.md ===')
  const wet = await proposeSkillFrom(makeCard(), { drafter: goodDrafter, apply: true, now: NOW, proposedDir })
  assert('apply: wrote=true', wet.wrote === true, wet.reason)
  const file = path.join(proposedDir, 'add-coordinator-endpoint', 'SKILL.md')
  assert('apply: file tồn tại', fs.existsSync(file))
  const md = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  assert('apply: frontmatter status: proposed', /status:\s*proposed/.test(md))
  assert('apply: có name slug', /name:\s*add-coordinator-endpoint/.test(md))
  assert('apply: có evidenced_by card', md.includes('c-learn'))
  assert('apply: cảnh báo CHƯA active', md.includes('CHƯA active'))

  // ── refuse / null drafter ──
  console.log('\n=== C: reusable=false / drafter null → không đề xuất ===')
  const ref = await proposeSkillFrom(makeCard(), { drafter: refuseDrafter, apply: true, now: NOW, proposedDir })
  assert('refuse: proposed=false', ref.proposed === false, ref.reason)
  const nul = await proposeSkillFrom(makeCard(), { drafter: nullDrafter, apply: true, now: NOW, proposedDir })
  assert('null drafter: proposed=false', nul.proposed === false, nul.reason)

  // ── M3.6 skillsOverview: proposed KHÔNG bị tính là active ──
  console.log('\n=== D: skillsOverview (M3.6) ===')
  // build skills dir giả: INDEX.md (1 active) + _proposed/<slug> đã ghi ở B
  fs.writeFileSync(path.join(tmp, 'INDEX.md'),
    '# INDEX\n\n- **demo-active** — skill active demo. · [`skills/demo/SKILL.md`](skills/demo/SKILL.md)\n')
  const prevSkills = process.env.LUCY_SKILLS
  const prevLearn = process.env.LUCY_SKILL_LEARN
  process.env.LUCY_SKILLS = tmp
  process.env.LUCY_SKILL_LEARN = '1'
  try {
    const ov = skillsOverview()
    assert('overview: configured', ov.configured === true)
    assert('overview: learnOn=true', ov.learnOn === true)
    assert('overview: 1 active', ov.activeCount === 1, String(ov.activeCount))
    assert('overview: ≥1 proposed', ov.proposedCount >= 1, String(ov.proposedCount))
    assert('overview: proposed có slug add-coordinator-endpoint',
      ov.proposed.some((s) => s.name === 'add-coordinator-endpoint'), JSON.stringify(ov.proposed.map((s) => s.name)))
    assert('overview: active KHÔNG chứa proposed (tách bạch)',
      !ov.active.some((s) => s.name === 'add-coordinator-endpoint'))
  } finally {
    if (prevSkills === undefined) delete process.env.LUCY_SKILLS; else process.env.LUCY_SKILLS = prevSkills
    if (prevLearn === undefined) delete process.env.LUCY_SKILL_LEARN; else process.env.LUCY_SKILL_LEARN = prevLearn
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  console.log(`\n=== KẾT QUẢ: ${pass} pass / ${fail} fail ===`)
  if (fail > 0) { console.log('❌ SMOKE FAILED'); process.exit(1) }
  console.log('✅ SMOKE PASSED'); process.exit(0)
})()
