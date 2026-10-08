// Smoke CỤM A — Prompt Architect: flag gate · scaffold load · clarify-gate · extract prompt · store round-trip · escalate (mock).
// KHÔNG cần mạng (logic + store dùng tmp vault). Có chế độ --live gọi model thật nếu có key (in kết quả, không fail nếu nghẽn).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  promptArchitectFlagOn, loadPromptArchitectPersona, isClarifying, extractFinalPrompt,
  sanitizeChatHistory, escalatePromptArchitect, recordUserEdit, runPromptArchitect, PA_DEFAULT_LANE,
  buildSystemAddendum,
} from './prompt-architect'
import { PromptArchitectStore } from './prompt-architect-store'
import {
  scorePromptDraft, derivePreferences, buildPreferencePreamble, targetModelStyleHint,
  extractAllPrompts, variantsDirective,
} from './prompt-architect-intel'

let pass = 0, fail = 0
function ok(name: string, cond: boolean) { if (cond) { pass++; console.log('  ✅ ' + name) } else { fail++; console.log('  ❌ ' + name) } }

async function main() {
  // ── flag gate (mặc định TẮT) ──
  const saved = process.env.LUCY_PROMPT_ARCHITECT
  delete process.env.LUCY_PROMPT_ARCHITECT
  ok('flag mặc định TẮT', !promptArchitectFlagOn())
  process.env.LUCY_PROMPT_ARCHITECT = '1'; ok('flag = 1 → BẬT', promptArchitectFlagOn())
  process.env.LUCY_PROMPT_ARCHITECT = 'off'; ok('flag = off → TẮT', !promptArchitectFlagOn())
  if (saved === undefined) delete process.env.LUCY_PROMPT_ARCHITECT; else process.env.LUCY_PROMPT_ARCHITECT = saved

  // ── scaffold persona: load + ép đủ 7 nguyên tắc trong systemPrompt ──
  const persona = loadPromptArchitectPersona()
  ok('persona load được', !!persona && persona.id === 'prompt-architect')
  const sp = persona?.systemPrompt || ''
  ok('scaffold: section template (role/context/task/constraints/output/self_check)',
    /<role>/.test(sp) && /<context>/.test(sp) && /<task>/.test(sp) && /<constraints>/.test(sp) && /<output_format>/.test(sp) && /<self_check>/.test(sp))
  ok('scaffold: kết luận/output để CUỐI', /CUỐI/i.test(sp))
  ok('scaffold: giữ NGUYÊN guideline user', /GIỮ NGUYÊN/i.test(sp))
  ok('scaffold: meta-prompt rewrite 1 lần', /REWRITE 1 LẦN/i.test(sp))
  ok('scaffold: clarify-gate ≤3 + nghiêng trả lời', /CLARIFY-GATE/i.test(sp) && /TỐI ĐA 3/i.test(sp) && /NGHIÊNG VỀ TRẢ LỜI/i.test(sp))
  ok('scaffold: rewrite-then-edit', /REWRITE-THEN-EDIT/i.test(sp))
  ok('scaffold: giữ vai structural + escalate', /STRUCTURAL/i.test(sp) && /escalate/i.test(sp))
  ok('scaffold: target-model aware', /TARGET-MODEL AWARE/i.test(sp))
  ok('scaffold: KHÔNG EXECUTE', /KHÔNG EXECUTE/i.test(sp))
  ok('persona dùng lane RẺ ds-chat + no tools (no-execute)', persona?.laneModel === PA_DEFAULT_LANE && (persona?.allowedTools?.length ?? 0) === 0)

  // ── clarify-gate detector ──
  ok('clarify: câu hỏi (có ? không có khối prompt) → clarifying', isClarifying('Em cần hỏi nhanh:\n1. Đối tượng là ai?\n2. Output dạng gì?'))
  ok('clarify: có khối ```prompt``` → KHÔNG clarifying', !isClarifying('Đây prompt:\n```prompt\n<task>...</task>\n```'))
  ok('clarify: có <task> dù có ? → KHÔNG clarifying', !isClarifying('<role>x</role>\n<task>làm gì đó? cụ thể</task>'))

  // ── extract final prompt từ khối ──
  const ex = extractFinalPrompt('intro\n```prompt\n<role>R</role>\n<task>T</task>\n```\nngoài')
  ok('extract: bóc đúng nội dung khối', ex.includes('<role>R</role>') && ex.includes('<task>T</task>') && !ex.includes('intro'))
  ok('extract: không khối → rỗng', extractFinalPrompt('chỉ là câu hỏi?') === '')

  // ── sanitizeChatHistory ──
  const h = sanitizeChatHistory([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'system', content: 'x' }, null, { role: 'user', content: '' }])
  ok('history giữ user/assistant, loại system/rỗng/null', h.length === 2 && h[0].role === 'user' && h[1].role === 'assistant')

  // ── store round-trip (tmp vault) ──
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-store-'))
  const store = new PromptArchitectStore(tmp)
  const id = store.recordSession({ source: 'cli', chatId: 'c1', targetModel: 'claude', contextInput: 'viết blog AI', finalPrompt: '<task>blog</task>', laneModel: 'ds-chat' })
  ok('store: ghi phiên trả id', typeof id === 'number' && (id as number) > 0)
  ok('store: scrub secret (sk-… không lọt)', (() => {
    const sid = store.recordSession({ source: 'cli', contextInput: 'key của em là sk-ant-api03-ABCDEF1234567890qwerty', finalPrompt: 'x' })
    const row = store.recent({ limit: 5 }).find((r) => r.id === sid)
    return !!row && !/sk-ant-api03-ABCDEF/.test(row.contextInput)
  })())
  ok('store: recordUserEdit cập nhật', store.recordUserEdit(id!, 'bản em sửa') && store.recent({ chatId: 'c1' })[0].userEdit === 'bản em sửa')
  ok('store: markEscalated', store.markEscalated(id!) && !!store.recent({ chatId: 'c1' }).find((r) => r.id === id && r.escalated === 1))
  ok('store: stats đếm đúng', store.stats().sessions >= 2)
  store.close()
  // recordUserEdit qua singleton (vault tmp khác → chỉ kiểm không nổ)
  ok('recordUserEdit helper không nổ', typeof recordUserEdit(999999, 'x', tmp) === 'boolean')

  // ── escalate với runner MOCK (khỏi cần claude) ──
  const escRes = await escalatePromptArchitect('viết prompt khó về RAG', {
    persona, vaultDir: tmp,
    runner: async (_sys, _user, _model) => '```prompt\n<role>RAG architect</role>\n<task>thiết kế pipeline</task>\n<output_format>markdown</output_format>\n```',
  })
  ok('escalate: trả prompt cuối + escalated=true', escRes.escalated && escRes.finalPrompt.includes('RAG architect'))
  ok('escalate: lưu phiên mới (sessionId)', typeof escRes.sessionId === 'number')

  // ── CỤM C — Scorecard (deterministic) ──
  const fullPrompt = '<role>nhà phân tích tài chính chuyên crypto và macro</role>\n<context>chủ nhân theo dõi BTC ETH vàng lãi suất Fed mỗi ngày</context>\n<task>tóm tắt diễn biến thị trường, nêu xu hướng và khi nào nên cân nhắc vào lệnh, kèm mức rủi ro</task>\n<constraints>tiếng Việt, gọn, chỉ số liệu thật có nguồn, không khuyên đầu tư bảo đảm</constraints>\n<output_format>bullet ngắn theo từng tài sản, có nguồn + thời điểm</output_format>\n<self_check>đã dẫn nguồn? đã nêu rủi ro?</self_check>'
  const scFull = scorePromptDraft(fullPrompt)
  ok('scorecard: prompt đầy đủ → điểm cao + 0 weak', scFull.total >= 75 && scFull.weak.length === 0)
  const scThin = scorePromptDraft('<task>viết gì đó</task>')
  ok('scorecard: prompt sơ sài → điểm thấp + có weak', scThin.total < 60 && scThin.weak.length > 0)
  ok('scorecard: rỗng → 0 + summary báo chưa có', scorePromptDraft('').total === 0 && /chưa có/i.test(scorePromptDraft('').summary))
  ok('scorecard: đủ 7 tiêu chí có weight tổng ~1', scFull.criteria.length === 7 && Math.abs(scFull.criteria.reduce((s, c) => s + c.weight, 0) - 1) < 0.001)

  // ── CỤM C — Preference/few-shot ──
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-pref-'))
  const st2 = new PromptArchitectStore(tmp2)
  for (let i = 0; i < 4; i++) st2.recordSession({ chatId: 'pref', source: 'hub', targetModel: 'claude', contextInput: 'giúp em viết prompt phân tích thị trường gọn gàng', finalPrompt: '<role>x</role><task>tóm tắt ngắn</task>', laneModel: 'ds-chat' })
  const prof = derivePreferences(st2.recent({ chatId: 'pref', limit: 20 }))
  ok('preferences: nhận diện tiếng Việt + target claude', prof.language === 'vi' && prof.topTargetModels.includes('claude') && prof.samples === 4)
  ok('preferences: lengthStyle gọn (prompt ngắn)', prof.lengthStyle === 'gọn')
  const preamble = buildPreferencePreamble(prof)
  ok('preferences: preamble có nhắc tiếng Việt + claude', /TIẾNG VIỆT/i.test(preamble) && /claude/i.test(preamble))
  ok('preferences: <2 mẫu → preamble rỗng (không nhồi nhiễu)', buildPreferencePreamble(derivePreferences(st2.recent({ chatId: 'none', limit: 20 }))) === '')
  st2.close()

  // ── CỤM C — target-model tailoring ──
  ok('target-hint: claude → XML', /XML/i.test(targetModelStyleHint('claude-opus-4')))
  ok('target-hint: gpt → bullet/gọn', /bullet|GỌN/i.test(targetModelStyleHint('gpt-5')))
  ok('target-hint: model nhỏ → NGẮN', /NGẮN/i.test(targetModelStyleHint('llama-3-8b')))
  ok('target-hint: rỗng khi không biết', targetModelStyleHint('') === '')
  ok('buildSystemAddendum: ghép + bỏ rỗng', buildSystemAddendum({ preferencePreamble: 'A', targetStyle: '' }) === 'A' && buildSystemAddendum({ preferencePreamble: 'A', targetStyle: 'B' }) === 'A\n\nB')

  // ── CỤM C — đa biến thể ──
  const multi = 'Biến thể 1:\n```prompt\n<task>cách A</task>\n```\nBiến thể 2:\n```prompt\n<task>cách B</task>\n```'
  const allP = extractAllPrompts(multi)
  ok('variants: bóc đủ 2 khối prompt', allP.length === 2 && allP[0].includes('cách A') && allP[1].includes('cách B'))
  ok('variants: bỏ khối rỗng', extractAllPrompts('```prompt\n\n```\n```prompt\nX\n```').length === 1)
  ok('variants: directive clamp 2..4', /3 BIẾN THỂ/.test(variantsDirective(3)) && /4 BIẾN THỂ/.test(variantsDirective(9)) && /2 BIẾN THỂ/.test(variantsDirective(1)))

  // ── LIVE (tùy chọn): gọi model rẻ thật nếu có key. KHÔNG fail khi nghẽn/không key. ──
  if (process.argv.includes('--live')) {
    console.log('\n  -- LIVE: gọi model rẻ thật (ds-chat) --')
    try {
      const live = await runPromptArchitect('giúp tôi viết content', { source: 'cli', vaultDir: tmp, save: false })
      const isQuestionOrPrompt = live.clarifying || !!live.finalPrompt || /<task>/i.test(live.answer)
      console.log('  model:', live.laneModel, '| clarifying:', live.clarifying, '| finalPrompt len:', live.finalPrompt.length)
      console.log('  ANSWER (cắt 500):\n   ' + live.answer.slice(0, 500).replace(/\n/g, '\n   '))
      ok('LIVE: ngữ cảnh lam man → HỎI làm rõ HOẶC xuất prompt sections', isQuestionOrPrompt || !!live.rateLimit)
    } catch (e) { console.log('  ⚠️ LIVE skip:', String(e instanceof Error ? e.message : e).slice(0, 160)) }
  }

  console.log(`\n${fail ? '❌' : '✅'} ${fail ? 'FAIL' : 'ALL PASS'} — ${pass} pass, ${fail} fail`)
  process.exit(fail ? 1 : 0)
}
main()
