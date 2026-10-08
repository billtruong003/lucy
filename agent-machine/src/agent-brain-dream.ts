// agent-brain-dream — C4 "dream-per-persona": gộp bài học THÔ của 1 persona thành RULE class-level.
// Crib Hermes background_review.py: ưu tiên rule TÁI DÙNG được + danh sách KHÔNG-được-bắt (chống tự-trói).
// Khác active.md/preferences (dream chung của Lucy): đây là não NGHỀ riêng từng agent.
//
// An toàn: fire-and-forget, env-guard LUCY_VAULT, mọi lỗi nuốt im (VPS không có claude = no-op).
// LLM rẻ (haiku), 1-shot, không tool — chỉ TRẢ JSON mảng rule. KHÔNG bao giờ làm gãy gì.
import fs from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'  // Đường B: 1-shot consolidate in-process
import { readRawLessons, writeConsolidated, lessonCount, listAgentBrains, CONSOLIDATE_THRESHOLD, MAX_CONSOLIDATED } from './agent-brain'

const TIMEOUT_SEC = 90

// Prompt gộp — bám blacklist Hermes (KHÔNG bắt lỗi môi trường/transient/tiêu-cực-về-tool/chuyện-1-lần).
export function buildConsolidatePrompt(personaId: string, raw: string[]): string {
  return [
    `Bạn là bộ phận "đúc kết não nghề" của 1 agent tên "${personaId}" trong hệ multi-agent.`,
    `Dưới đây là các BÀI HỌC THÔ agent này tích luỹ (mỗi dòng 1 bài, nhãn ⚠️ tránh = lỗi bị trả lại, ✅ tốt = cách làm hiệu quả):`,
    ``,
    raw.map((l, i) => `${i + 1}. ${l}`).join('\n'),
    ``,
    `## Việc của bạn`,
    `Gộp/đúc kết thành TỐI ĐA ${MAX_CONSOLIDATED} RULE CLASS-LEVEL (quy tắc nghề tái dùng được cho nhiều task), không phải chép lại từng bài.`,
    `- Gộp các bài cùng gốc thành 1 rule tổng quát hơn.`,
    `- Viết dạng hành động ("Luôn X trước khi Y", "Tránh Z vì..."), 1 câu, súc tích.`,
    `- Ưu tiên rule có giá trị cao (lặp nhiều / hậu quả nặng) lên đầu.`,
    ``,
    `## KHÔNG ĐƯỢC GIỮ (bỏ các bài thuộc loại này — chúng hoá đá thành tự-trói khi môi trường đổi):`,
    `- Lỗi môi trường/setup: thiếu binary/dep, sai path máy, credential chưa cấu hình — chủ sửa được, không phải quy tắc bền.`,
    `- Khẳng định tiêu cực về tool ("X không dùng được", "Y hỏng") — sau khi tool được sửa thì rule này tự phá agent.`,
    `- Lỗi transient tự hết khi retry — bài học (nếu có) là retry-pattern, không phải lỗi gốc.`,
    `- Chuyện 1 lần của riêng 1 task, không tái dùng cho task khác.`,
    ``,
    `Trả về DUY NHẤT 1 mảng JSON (không chữ nào khác), mỗi phần tử là 1 string rule:`,
    `["rule 1", "rule 2", ...]`,
    `Nếu sau khi lọc không còn gì đáng giữ → trả [].`,
  ].join('\n')
}

export function parseRules(raw: string): string[] {
  let text = raw
  try { const d = JSON.parse(raw) as { result?: string }; if (typeof d.result === 'string') text = d.result } catch { /* không phải envelope */ }
  const fence = text.match(/```json\s*([\s\S]*?)```/)
  const arrText = fence ? fence[1] : (text.match(/\[[\s\S]*\]/)?.[0] ?? '')
  if (!arrText) return []
  let arr: unknown
  try { arr = JSON.parse(arrText) } catch { return [] }
  if (!Array.isArray(arr)) return []
  return arr.filter((x): x is string => typeof x === 'string' && x.trim().length >= 8).map((x) => x.trim()).slice(0, MAX_CONSOLIDATED)
}

// Đường B: query() 1-shot, KHÔNG tool, model rẻ. Trả result text (parseRules tự bóc envelope/raw). Lỗi → '' (no-op).
async function sdkConsolidate(prompt: string, model: string): Promise<string> {
  const safeModel = /^[A-Za-z0-9._-]+$/.test(model) ? model : 'haiku'
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_SEC * 1000)
  let result = ''
  try {
    const q = query({
      prompt,
      options: { model: safeModel, maxTurns: 1, allowedTools: [], permissionMode: 'bypassPermissions', env: { ...process.env, IS_SANDBOX: '1' }, abortController: ac },
    } as any)
    for await (const m of q as any) { if (m.type === 'result') result = m.result ?? '' }
  } catch { result = '' }
  clearTimeout(timer)
  return result
}

// runner injectable → test không cần claude thật.
export type RuleRunner = (prompt: string) => Promise<string>

/** Gộp não 1 persona. Trả {before, after} nếu đã ghi; null nếu chưa đủ ngưỡng / lỗi / không có rule. Throw KHÔNG bao giờ. */
export async function consolidateAgentBrain(personaId: string, opts: { run?: RuleRunner; force?: boolean } = {}): Promise<{ personaId: string; before: number; after: number } | null> {
  try {
    const before = lessonCount(personaId)
    if (!opts.force && before < CONSOLIDATE_THRESHOLD) return null // chưa đủ thô để đáng gộp
    const raw = readRawLessons(personaId)
    if (!raw.length) return null
    const prompt = buildConsolidatePrompt(personaId, raw)
    const run: RuleRunner = opts.run ?? ((p) => sdkConsolidate(p, process.env.LUCY_DISTILL_MODEL || 'haiku'))
    let out = await run(prompt)
    if (!out.trim()) { await new Promise((r) => setTimeout(r, 1500)); out = await run(prompt) } // 1 lần retry hiccup
    const rules = parseRules(out)
    if (!rules.length) return null // model trả [] hoặc lỗi → GIỮ bài thô, không xoá trắng
    if (!writeConsolidated(personaId, rules)) return null
    return { personaId, before, after: rules.length }
  } catch { return null }
}

/** Quét MỌI persona có não → gộp cái nào quá ngưỡng. Cho dream cron. Env-guard + fire-safe. */
export async function consolidateAllAgentBrainsSafe(opts: { run?: RuleRunner } = {}): Promise<{ personaId: string; before: number; after: number }[]> {
  const vault = process.env.LUCY_VAULT
  if (!vault || !fs.existsSync(vault) || process.env.LUCY_BRAIN_DREAM === '0') return []
  const out: { personaId: string; before: number; after: number }[] = []
  for (const id of listAgentBrains()) {
    const r = await consolidateAgentBrain(id, opts)
    if (r) out.push(r)
  }
  return out
}
