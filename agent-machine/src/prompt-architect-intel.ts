// prompt-architect-intel — CỤM C / "thông minh hoá" tính năng Prompt Architect (architecture mục 4).
// 4 việc BACKEND, ADDITIVE, KHÔNG đụng core flow:
//   1. PREFERENCE/FEW-SHOT  — bóc phong cách chủ nhân từ lịch sử phiên (ngôn ngữ/độ dài/target hay dùng) → preamble nhắc model rẻ.
//   2. PROMPT SCORECARD     — chấm bản nháp prompt theo rubric (DETERMINISTIC, không tốn token) → điểm + chỗ yếu (self-check + dạy chủ nhân).
//   3. ĐA BIẾN THỂ          — bóc NHIỀU khối ```prompt``` khi persona xuất 2-3 biến thể (caller bật qua opts.variants).
//   4. TARGET-MODEL TAILORING — gợi ý style theo model đích (Claude=XML, GPT=bullet, model nhỏ=ngắn) chèn vào system addendum.
// THUẦN logic + chuỗi: KHÔNG gọi LLM, KHÔNG IO ngoài (trừ caller truyền sessions vào). Dễ smoke, không mạng.
import type { PromptSession } from './prompt-architect-store'

// ── 2. PROMPT SCORECARD (deterministic) ─────────────────────────────────────
export type ScoreCriterion = {
  key: string
  label: string
  score: number   // 0..100
  weight: number  // trọng số (tổng = 1)
  note: string    // gợi ý ngắn nếu yếu
}
export type Scorecard = {
  total: number              // 0..100 (làm tròn)
  criteria: ScoreCriterion[]
  weak: string[]             // key các tiêu chí < ngưỡng (cho UI bôi đỏ + dạy chủ nhân)
  summary: string            // 1 dòng tóm tắt
}

// Có khối/section <tag> … </tag> (hoặc dạng "tag:" đầu dòng) trong prompt không?
function hasSection(p: string, tag: string): boolean {
  const re = new RegExp(`<${tag}\\b|(^|\\n)\\s*${tag}\\s*[:：]`, 'i')
  return re.test(p)
}
// Nội dung 1 section dài bao nhiêu từ (đo độ "đặc"). 0 nếu không có.
function sectionWordCount(p: string, tag: string): number {
  const m = p.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  if (!m) return 0
  return m[1].trim().split(/\s+/).filter(Boolean).length
}

const WEAK_THRESHOLD = 60

/**
 * Chấm 1 bản nháp prompt theo rubric (clarity/role/context/task/constraints/output/self-check/specificity).
 * DETERMINISTIC — chỉ soi cấu trúc + độ đặc, KHÔNG gọi model. Trả điểm 0..100 + chỗ yếu.
 */
export function scorePromptDraft(finalPrompt: string): Scorecard {
  const p = (finalPrompt || '').trim()
  const words = p ? p.split(/\s+/).filter(Boolean).length : 0

  // mỗi tiêu chí: present (0/1) + độ đặc (word count) → 0..100
  const presence = (tag: string) => (hasSection(p, tag) ? 1 : 0)
  const density = (tag: string, min: number) => {
    const wc = sectionWordCount(p, tag)
    if (!hasSection(p, tag)) return 0
    if (wc === 0) return 60               // có tag nhưng (regex section) không bóc được nội dung → coi như có, vừa phải
    return Math.min(100, 50 + Math.round((Math.min(wc, min) / min) * 50))
  }

  const criteria: ScoreCriterion[] = [
    { key: 'role', label: 'Vai trò (role)', weight: 0.12,
      score: presence('role') ? density('role', 8) : 0,
      note: 'Thêm <role> nêu rõ model đóng vai/chuyên môn gì.' },
    { key: 'context', label: 'Bối cảnh (context)', weight: 0.15,
      score: presence('context') ? density('context', 20) : 0,
      note: 'Thêm <context> dữ kiện nền để model bớt đoán mò.' },
    { key: 'task', label: 'Nhiệm vụ (task)', weight: 0.22,
      score: presence('task') ? density('task', 15) : 0,
      note: 'Mô tả <task> cụ thể, chia bước nếu nhiều việc.' },
    { key: 'constraints', label: 'Ràng buộc (constraints)', weight: 0.15,
      score: presence('constraints') ? density('constraints', 10) : 0,
      note: 'Thêm <constraints>: điều cấm, giọng văn, ngôn ngữ, độ dài.' },
    { key: 'output_format', label: 'Định dạng output', weight: 0.18,
      score: presence('output_format') ? density('output_format', 8) : 0,
      note: 'Thêm <output_format> tả rõ cấu trúc kết quả mong muốn (để CUỐI).' },
    { key: 'self_check', label: 'Tự rà (self-check)', weight: 0.08,
      score: presence('self_check') ? 90 : 0,
      note: 'Thêm <self_check> checklist model tự kiểm trước khi trả.' },
    { key: 'specificity', label: 'Độ cụ thể tổng thể', weight: 0.10,
      score: words === 0 ? 0 : Math.max(20, Math.min(100, Math.round((Math.min(words, 80) / 80) * 100))),
      note: 'Prompt quá ngắn/mơ hồ — bổ sung chi tiết, ví dụ, tiêu chí thành công.' },
  ]

  const total = p
    ? Math.round(criteria.reduce((s, c) => s + c.score * c.weight, 0))
    : 0
  const weak = criteria.filter((c) => c.score < WEAK_THRESHOLD).map((c) => c.key)
  const grade = total >= 85 ? 'xuất sắc' : total >= 70 ? 'tốt' : total >= 50 ? 'tạm' : 'yếu'
  const summary = p
    ? `${total}/100 (${grade})${weak.length ? ' · cần bồi: ' + weak.join(', ') : ''}`
    : 'chưa có prompt để chấm'
  return { total, criteria, weak, summary }
}

// ── 1. PREFERENCE / FEW-SHOT (bóc từ lịch sử phiên) ──────────────────────────
export type PreferenceProfile = {
  language: 'vi' | 'en' | 'mixed' | 'unknown'
  avgFinalWords: number          // độ dài prompt cuối trung bình
  lengthStyle: 'gọn' | 'vừa' | 'dài' | 'unknown'
  topTargetModels: string[]      // model đích hay nhắm tới (nhiều→ít)
  editsRatio: number             // tỉ lệ phiên chủ nhân sửa tay (0..1) → chủ nhân khó tính → nên cẩn thận
  samples: number                // số phiên dùng để bóc
}

// Đoán ngôn ngữ thô (đủ cho gợi ý) — đếm dấu tiếng Việt.
function detectLang(text: string): 'vi' | 'en' | 'unknown' {
  const t = (text || '').trim()
  if (!t) return 'unknown'
  if (/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i.test(t)) return 'vi'
  if (/[a-z]/i.test(t)) return 'en'
  return 'unknown'
}

/**
 * Bóc phong cách chủ nhân từ N phiên gần nhất (đã lọc theo chatId ở caller).
 * DETERMINISTIC. Phiên rỗng → profile 'unknown' (caller bỏ qua, không nhồi nhiễu).
 */
export function derivePreferences(sessions: PromptSession[]): PreferenceProfile {
  const real = (sessions || []).filter((s) => s && (s.contextInput || s.finalPrompt))
  if (!real.length) {
    return { language: 'unknown', avgFinalWords: 0, lengthStyle: 'unknown', topTargetModels: [], editsRatio: 0, samples: 0 }
  }
  // ngôn ngữ: vote trên contextInput của chủ nhân
  let vi = 0, en = 0
  for (const s of real) { const l = detectLang(s.contextInput); if (l === 'vi') vi++; else if (l === 'en') en++ }
  const language: PreferenceProfile['language'] = vi && en ? (vi > en * 2 ? 'vi' : en > vi * 2 ? 'en' : 'mixed') : vi ? 'vi' : en ? 'en' : 'unknown'

  // độ dài prompt cuối
  const withFinal = real.filter((s) => s.finalPrompt)
  const avgFinalWords = withFinal.length
    ? Math.round(withFinal.reduce((sum, s) => sum + s.finalPrompt.split(/\s+/).filter(Boolean).length, 0) / withFinal.length)
    : 0
  const lengthStyle: PreferenceProfile['lengthStyle'] = avgFinalWords === 0 ? 'unknown'
    : avgFinalWords < 60 ? 'gọn' : avgFinalWords < 140 ? 'vừa' : 'dài'

  // target models hay dùng
  const tally = new Map<string, number>()
  for (const s of real) { const m = (s.targetModel || '').trim().toLowerCase(); if (m) tally.set(m, (tally.get(m) || 0) + 1) }
  const topTargetModels = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m]) => m)

  const edited = real.filter((s) => (s.userEdit || '').trim()).length
  const editsRatio = Math.round((edited / real.length) * 100) / 100

  return { language, avgFinalWords, lengthStyle, topTargetModels, editsRatio, samples: real.length }
}

/**
 * Dựng PREAMBLE few-shot nhắc model rẻ áp phong cách chủ nhân (chèn vào system addendum).
 * Rỗng khi profile 'unknown'/ít mẫu → KHÔNG nhồi nhiễu khi chưa đủ dữ liệu.
 */
export function buildPreferencePreamble(profile: PreferenceProfile): string {
  if (!profile || profile.samples < 2 || profile.language === 'unknown') return ''
  const bits: string[] = []
  if (profile.language === 'vi') bits.push('viết prompt + trao đổi bằng TIẾNG VIỆT')
  else if (profile.language === 'en') bits.push('chủ nhân quen tiếng Anh — output prompt có thể bằng tiếng Anh')
  if (profile.lengthStyle === 'gọn') bits.push('chuộng prompt GỌN, đúng trọng tâm (đừng dài dòng)')
  else if (profile.lengthStyle === 'dài') bits.push('OK với prompt CHI TIẾT, nhiều ràng buộc')
  if (profile.topTargetModels.length) bits.push(`hay nhắm model đích: ${profile.topTargetModels.join(', ')}`)
  if (profile.editsRatio >= 0.5) bits.push('chủ nhân hay sửa tay prompt → cố làm chuẩn ngay, để chỗ dễ chỉnh')
  if (!bits.length) return ''
  return `[PHONG CÁCH CHỦ NHÂN — học từ ${profile.samples} phiên trước, áp khi phù hợp]\n- ` + bits.join('\n- ')
}

// ── 4. TARGET-MODEL TAILORING ────────────────────────────────────────────────
/**
 * Gợi ý style prompt theo model đích (prompt không transfer tốt giữa model).
 * Rỗng nếu không biết target → persona tự dùng mặc định XML (an toàn) theo scaffold.
 */
export function targetModelStyleHint(targetModel?: string): string {
  const m = (targetModel || '').trim().toLowerCase()
  if (!m) return ''
  if (/claude|opus|sonnet|haiku|anthropic/.test(m))
    return `[STYLE cho ${targetModel}] Claude ưa TAG XML rõ ràng + chỗ cho reasoning từng bước; đặt output_format ở CUỐI.`
  if (/gpt|o1|o3|o4|openai|chatgpt/.test(m))
    return `[STYLE cho ${targetModel}] GPT ưa system role GỌN + bullet rành mạch + tiêu chí thành công cụ thể; bớt lồng tag sâu.`
  if (/gemini|bard/.test(m))
    return `[STYLE cho ${targetModel}] Gemini ưa cấu trúc rõ + ví dụ cụ thể; nêu rõ định dạng output mong muốn.`
  if (/(llama|mistral|qwen|deepseek|phi|gemma|small|mini|nano|7b|8b|3b|1b)/.test(m))
    return `[STYLE cho ${targetModel}] Model nhỏ → prompt NGẮN, 1 nhiệm vụ rõ, ÍT tầng lồng, kèm 1 ví dụ nếu được.`
  return `[STYLE cho ${targetModel}] Giữ cấu trúc rõ ràng, tag XML để dễ port; ghi giả định nếu chưa rõ đặc tính model.`
}

// ── 3. ĐA BIẾN THỂ — bóc TẤT CẢ khối ```prompt``` trong 1 output ──────────────
/** Bóc mọi khối ```…``` (ưu tiên ```prompt```). Trả mảng nội dung (đã trim), bỏ khối rỗng. */
export function extractAllPrompts(answer: string): string[] {
  const out: string[] = []
  const re = /```(?:prompt)?\s*\n?([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(answer || '')) !== null) {
    const body = (m[1] || '').trim()
    if (body) out.push(body)
  }
  return out
}

/** Chỉ thị YÊU CẦU persona xuất N biến thể prompt (chèn vào ngữ cảnh khi opts.variants>1). */
export function variantsDirective(n: number): string {
  const k = Math.max(2, Math.min(n || 2, 4))
  return `\n\n[YÊU CẦU ĐA BIẾN THỂ] Ngữ cảnh còn nhiều cách hiểu hợp lý → thay vì hỏi, hãy xuất ${k} BIẾN THỂ prompt theo ${k} cách hiểu/độ chi tiết khác nhau. MỖI biến thể là 1 khối \`\`\`prompt … \`\`\` riêng, kèm 1 dòng nhãn ngắn phía trên nêu biến thể đó nhắm gì. Chủ nhân sẽ chọn 1.`
}
