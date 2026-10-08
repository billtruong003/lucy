// persona-chat.ts — M3.5: trò chuyện ĐA LƯỢT với 1 persona + AUTO-ROUTING chọn đúng chuyên gia.
// Khác consult_expert (one-shot): mang ĐẦY ĐỦ danh tính persona — systemPrompt + agent-brain (đã học) + laneModel riêng — và NHỚ history.
// Route = lai keyword(tags/name) + embedding Jina (nếu LUCY_VECTOR bật) giữa câu hỏi ↔ mô tả persona.
import crypto from 'node:crypto'
import { chatLaneAgentic, type LaneChatResult } from './lane-chat'
import { readAgentBrain } from './agent-brain'
import { jinaEmbed, vectorFlagOn, type Embedder } from './embed'
import type { RawMsg } from './llm-lane'
import type { Persona } from './types'

// Flag gate (mặc định TẮT — chỉ bật khi đã verify). '1'/'true'/'on' → ON.
export function personaChatFlagOn(): boolean {
  const f = (process.env.LUCY_PERSONA_CHAT || '').toLowerCase()
  return f === '1' || f === 'true' || f === 'on'
}

// ─────────────────────────── CHAT ĐA LƯỢT ───────────────────────────
export type PersonaChatResult = LaneChatResult & { personaId: string; personaName: string }

// Lọc history thô (Hub/Telegram gửi) → RawMsg sạch: chỉ user/assistant, content chuỗi, cap 12 lượt gần.
export function sanitizeHistory(raw: unknown): RawMsg[] {
  if (!Array.isArray(raw)) return []
  const out: RawMsg[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const role = (m as any).role === 'assistant' ? 'assistant' : (m as any).role === 'user' ? 'user' : null
    const content = String((m as any).content ?? '').slice(0, 8000)
    if (!role || !content) continue
    out.push({ role, content })
  }
  return out.slice(-12)
}

export async function personaChat(persona: Persona, message: string, history: RawMsg[], ws: string, opts: { maxTurns?: number } = {}): Promise<PersonaChatResult> {
  let brain = ''
  try { brain = readAgentBrain(persona.id) || '' } catch { /* não chưa có → bỏ qua */ }
  const sys = `${persona.systemPrompt}${brain ? '\n\n--- NÃO NGHỀ (đã học) ---\n' + brain : ''}\n\n(Bạn đang TRÒ CHUYỆN TRỰC TIẾP với chủ nhân qua Lucy — đa lượt, NHỚ mạch hội thoại. Giữ đúng giọng + thế mạnh của bạn. Trả lời chất, gọn. Xưng em, gọi chủ nhân.)`
  const messages: RawMsg[] = [{ role: 'system', content: sys }, ...history, { role: 'user', content: message }]
  // allowConsult=false: persona ĐÃ là chuyên gia, không cho gọi consult lồng nhau (giữ token rẻ + tránh đệ quy).
  const r = await chatLaneAgentic(persona.laneModel || 'or-nemotron-super', messages, ws, { maxTurns: opts.maxTurns ?? 8, allowConsult: false })
  return { ...r, personaId: persona.id, personaName: persona.name }
}

// ─────────────────────────── AUTO-ROUTING ───────────────────────────
export type RouteRanked = { personaId: string; name: string; score: number; tagScore: number; vecScore: number }
export type RouteResult = { personaId: string | null; name?: string; confidence: number; why: string; mode: 'vector+tag' | 'tag'; ranked: RouteRanked[] }

function strip(s: string): string { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd') }
function tokenize(s: string): string[] { return strip(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1) }
function personaText(p: Persona): string { return [p.name, (p.tags || []).join(' '), (p.systemPrompt || '').slice(0, 400)].join(' · ') }
function sig(s: string): string { return crypto.createHash('sha1').update(s).digest('hex') }

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

// keyword overlap: token câu hỏi ↔ {tags, tên, prompt} của persona. 0..1.
function tagScore(qTokens: string[], p: Persona): number {
  if (!qTokens.length) return 0
  const hay = new Set(tokenize([(p.tags || []).join(' '), p.name, (p.systemPrompt || '').slice(0, 300)].join(' ')))
  const tagSet = new Set(tokenize((p.tags || []).join(' ')))
  let hit = 0, tagHit = 0
  for (const t of qTokens) { if (hay.has(t)) hit++; if (tagSet.has(t)) tagHit++ }
  // tag trùng nặng hơn (skill rõ ràng) so với trùng trong prompt
  return Math.min(1, (hit / qTokens.length) * 0.6 + Math.min(1, tagHit / 2) * 0.4)
}

const embCache = new Map<string, { sig: string; vec: number[] }>()

// Chọn persona hợp nhất cho câu hỏi. embedder injectable cho smoke (khỏi cần mạng).
export async function personaRoute(question: string, personas: Persona[], opts: { embedder?: Embedder | null } = {}): Promise<RouteResult> {
  // chỉ route vào specialist/executor (không vào orchestrator điều phối — đó là vai của Lucy/coordinator)
  const cands = personas.filter((p) => p.kind !== 'orchestrator')
  if (!cands.length) return { personaId: null, confidence: 0, why: 'không có chuyên gia nào', mode: 'tag', ranked: [] }
  const qTokens = tokenize(question)
  const tags = new Map(cands.map((p) => [p.id, tagScore(qTokens, p)]))

  const vec = new Map<string, number>()
  const embedder = opts.embedder !== undefined ? opts.embedder : (vectorFlagOn() ? jinaEmbed : null)
  if (embedder) {
    try {
      const [qv] = await embedder([question], 'retrieval.query')
      const need = cands.filter((p) => embCache.get(p.id)?.sig !== sig(personaText(p)))
      if (need.length) {
        const vecs = await embedder(need.map((p) => personaText(p)), 'retrieval.passage')
        need.forEach((p, i) => embCache.set(p.id, { sig: sig(personaText(p)), vec: vecs[i] }))
      }
      for (const p of cands) { const e = embCache.get(p.id); if (e && qv) vec.set(p.id, Math.max(0, cosine(qv, e.vec))) }
    } catch { /* vector lỗi → tự về tag thuần */ }
  }
  const useVec = vec.size > 0
  const ranked: RouteRanked[] = cands.map((p) => {
    const t = tags.get(p.id) || 0
    const v = vec.get(p.id) || 0
    const score = useVec ? 0.6 * v + 0.4 * t : t
    return { personaId: p.id, name: p.name, score, tagScore: t, vecScore: v }
  }).sort((a, b) => b.score - a.score)

  const top = ranked[0]
  const second = ranked[1]
  // confidence: điểm top + tách biệt so với á quân (gap rõ → tự tin hơn)
  const gap = second ? top.score - second.score : top.score
  const confidence = Math.max(0, Math.min(1, top.score * 0.7 + gap * 0.6))
  const matchedTags = (cands.find((p) => p.id === top.personaId)?.tags || []).filter((t) => qTokens.includes(strip(t)))
  const why = `${top.name} hợp nhất (điểm ${top.score.toFixed(2)}${useVec ? `, ngữ nghĩa ${top.vecScore.toFixed(2)}` : ''}${matchedTags.length ? `, khớp tag: ${matchedTags.join(', ')}` : ''})`
  return { personaId: top.personaId, name: top.name, confidence, why, mode: useVec ? 'vector+tag' : 'tag', ranked: ranked.slice(0, 6) }
}
