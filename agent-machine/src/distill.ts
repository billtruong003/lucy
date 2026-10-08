// distill.ts — A2 "auto-memory nền": card kết thúc (done/failed) → fork `claude -p` (model rẻ, 1 turn,
// không tool) distill bài học GIÀU hơn hook deterministic → ghi brain-signal ĐÚNG format vào Brain/inbox/.
// Crib: Hermes background_review.py (3 review-prompt + blacklist "KHÔNG được bắt") — rẻ hoá cho Lucy.
//
// Vá 3 lỗ hổng audit 2026-06-11:
//  • topic chuẩn hoá <projectId>/<pattern-chung> → 2 card khác nhau cùng lỗi gốc TÍCH LŨY được (per-card cũ thì không).
//  • có signal POSITIVE (cách làm tốt) — engine deterministic chỉ ghi negative (reject/rework).
//  • format frontmatter đúng schema dream (agent tự ghi free-text từng bị skip im lặng).
//
// An toàn: fire-and-forget, env-guard LUCY_VAULT, mọi lỗi nuốt im (spawn fail trên VPS không có claude =
// no-op — coordinator VPS vẫn "nhẹ"). KHÔNG bao giờ làm gãy pipeline.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { writeSignal } from './signal'
import { resolveClaude } from './claude-bin'
import { auxComplete } from './aux-client'
import type { Card } from './types'

export type DistilledSignal = { topic: string; signal: 'positive' | 'negative'; principle: string; scope?: string }

const DISTILL_TIMEOUT_SEC = 90
const MAX_SIGNALS = 3
const MAX_REPORT_CHARS = 1500 // mỗi report cắt còn nhiêu đây — đủ nắm ý, không phình prompt
const MAX_REPORTS = 4         // chỉ N report cuối (giai đoạn chốt mới nhiều bài học)

// Prompt distill — tiếng Việt, bám blacklist Hermes. Model chỉ TRẢ JSON, không tool.
function buildPrompt(card: Card): string {
  const history = card.history.map((h) => `${h.stage}:${h.event}${h.detail ? ` (${String(h.detail).slice(0, 150)})` : ''}`).join(' → ')
  const notes = card.reviewNotes?.length ? card.reviewNotes.map((n) => `- ${n}`).join('\n') : '(không có)'
  const reports = (card.reports || []).slice(-MAX_REPORTS)
    .map((r) => `### ${r.persona} @ ${r.stage}\n${r.text.slice(0, MAX_REPORT_CHARS)}`).join('\n\n') || '(không có)'
  return [
    `Bạn là bộ phận "học" của hệ multi-agent. 1 card vừa kết thúc — đọc và rút ra BÀI HỌC TÁI DÙNG ĐƯỢC (nếu có).`,
    ``,
    `## Card`,
    `- title: ${card.title}`, `- project: ${card.projectId}`, `- kết cục: ${card.status}`,
    `- brief: ${card.brief.slice(0, 600)}`,
    `- diễn biến: ${history.slice(0, 800)}`,
    `## Feedback của chủ (giá trị CAO nhất)`, notes,
    `## Báo cáo agent (các bước cuối)`, reports,
    ``,
    `## Việc của bạn`,
    `Trả về DUY NHẤT 1 mảng JSON (không chữ nào khác), tối đa ${MAX_SIGNALS} phần tử, mỗi phần tử:`,
    `{"topic":"${card.projectId}/<pattern-kebab>","signal":"positive|negative","principle":"<quy tắc 1 câu>","scope":"<stage/khía cạnh, optional>"}`,
    ``,
    `LUẬT topic (QUAN TRỌNG): phần sau "/" = TÊN PATTERN CHUNG mà card khác cũng có thể dính`,
    `(vd "hardcode-config", "thieu-verify-truoc-khi-bao-xong", "api-contract-doc-truoc") — KHÔNG phải tên card,`,
    `KHÔNG số PR/tên file cụ thể. kebab-case không dấu.`,
    `signal: "negative" = pattern lỗi cần tránh (bị trả lại / rework / fail) · "positive" = cách làm hiệu quả rõ rệt đáng lặp lại.`,
    `principle: viết dạng quy tắc hành động được ("luôn X trước khi Y"), KHÔNG kể chuyện.`,
    ``,
    `KHÔNG ĐƯỢC BẮT (trả bớt phần tử / [] nếu chỉ có loại này):`,
    `- Lỗi môi trường/setup: thiếu binary, thiếu dep, sai path máy, credential chưa cấu hình. Chủ sửa được — không phải quy tắc bền.`,
    `- Lỗi transient tự hết (retry là xong) — bài học là retry-pattern, không phải lỗi gốc.`,
    `- Khẳng định tiêu cực về tool ("X không dùng được") — hoá đá thành tự-trói sau khi tool được sửa.`,
    `- Chuyện 1 lần của riêng card này, không tái dùng cho card khác.`,
    `Card chạy mượt không có gì đáng học → trả [].`,
  ].join('\n')
}

// parse output claude -p --output-format json → mảng signal đã VALIDATE (lọc rác, cap, ép topic đúng project).
export function parseDistillOutput(raw: string, projectId: string): DistilledSignal[] {
  let text = raw
  try { const d = JSON.parse(raw) as { result?: string }; if (typeof d.result === 'string') text = d.result } catch { /* raw không phải envelope json */ }
  const fence = text.match(/```json\s*([\s\S]*?)```/)
  const arrText = fence ? fence[1] : (text.match(/\[[\s\S]*\]/)?.[0] ?? '')
  if (!arrText) return []
  let arr: unknown
  try { arr = JSON.parse(arrText) } catch { return [] }
  if (!Array.isArray(arr)) return []
  const out: DistilledSignal[] = []
  for (const it of arr) {
    if (out.length >= MAX_SIGNALS) break
    if (typeof it !== 'object' || it === null) continue
    const o = it as Record<string, unknown>
    const sig = o.signal
    const principle = String(o.principle || '').trim().slice(0, 200)
    let topic = String(o.topic || '').trim()
    if ((sig !== 'positive' && sig !== 'negative') || !principle) continue
    // ép topic về <projectId>/<pattern>: model lệch prefix thì sửa, pattern rỗng thì bỏ.
    const pattern = (topic.includes('/') ? topic.split('/').slice(1).join('-') : topic)
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
    if (!pattern) continue
    topic = `${projectId}/${pattern}`
    out.push({ topic, signal: sig, principle, ...(o.scope ? { scope: String(o.scope).slice(0, 40) } : {}) })
  }
  return out
}

function spawnClaude(prompt: string, model: string, bin: string): Promise<string> {
  return new Promise((resolve) => {
    // Windows: resolve claude.exe THẬT (né shim .cmd + cmd-quoting-hell). Prompt qua STDIN.
    const safeModel = /^[A-Za-z0-9._-]+$/.test(model) ? model : 'haiku'
    const r = resolveClaude(bin)
    const args = ['-p', '--output-format', 'json', '--model', safeModel, '--max-turns', '1']
    const opts = { stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'], env: { ...process.env, IS_SANDBOX: '1' } }
    // fallback shell (hiếm): command string TĨNH (đã sanitize, prompt đi stdin) → không escaping bẩn.
    const ch = r.shell ? spawn(`"${r.bin}" ${args.join(' ')}`, { ...opts, shell: true }) : spawn(r.bin, args, opts)
    let out = ''
    const timer = setTimeout(() => ch.kill(), DISTILL_TIMEOUT_SEC * 1000)
    ch.stdout.on('data', (d) => (out += d))
    ch.on('close', () => { clearTimeout(timer); resolve(out) })
    ch.on('error', () => { clearTimeout(timer); resolve('') }) // không có claude (VPS) → no-op
    ch.stdin.on('error', () => { /* EPIPE khi claude chết sớm — nuốt */ })
    ch.stdin.write(prompt); ch.stdin.end()
  })
}

// chạy 1 prompt distill qua claude (model rẻ) → mảng signal đã validate. Throw KHÔNG bao giờ.
// Tái dùng bởi distillCard (sau mỗi card) + bootstrap-cli (ký ức claude-memory → signal).
export async function runDistillPrompt(prompt: string, projectId: string, opts: { model?: string; bin?: string } = {}): Promise<DistilledSignal[]> {
  try {
    // C3: thử lane FREE trước (distill là side-task, không đáng đốt claude). Có kết quả parse ra signal → dùng luôn.
    // Tắt bằng LUCY_AUX=0. Lỗi/không có lane → null → rớt xuống claude (an toàn).
    if (process.env.LUCY_AUX !== '0' && !opts.model) {
      try {
        const auxRaw = await auxComplete(prompt, { maxTokens: 700 })
        if (auxRaw && auxRaw.trim()) {
          const sigs = parseDistillOutput(auxRaw, projectId)
          if (sigs.length) return sigs // chỉ tin lane khi RA signal hợp lệ; rỗng → để claude thử kỹ hơn
        }
      } catch { /* lane hỏng → claude lo */ }
    }
    const model = opts.model || process.env.LUCY_DISTILL_MODEL || 'haiku'
    const bin = opts.bin || process.env.CLAUDE_BIN || 'claude'
    let raw = await spawnClaude(prompt, model, bin)
    if (!raw.trim()) { // claude chết thoáng qua (spawn/API hiccup) → thử lại ĐÚNG 1 lần rồi thôi
      await new Promise((r) => setTimeout(r, 2000))
      raw = await spawnClaude(prompt, model, bin)
    }
    if (!raw.trim()) return []
    return parseDistillOutput(raw, projectId)
  } catch { return [] }
}

// distill 1 card → ghi signal files. Trả danh sách signal đã ghi (cho log/test). Throw KHÔNG bao giờ.
export async function distillCard(vaultDir: string, card: Card, opts: { model?: string; bin?: string } = {}): Promise<DistilledSignal[]> {
  try {
    const sigs = await runDistillPrompt(buildPrompt(card), card.projectId, opts)
    const written: DistilledSignal[] = []
    for (const s of sigs) {
      const f = writeSignal(vaultDir, { topic: s.topic, signal: s.signal, principle: s.principle, scope: s.scope, cardId: card.id, agent: 'distill', raw: `distill card "${card.title}" (${card.status})` })
      if (f) written.push(s)
    }
    return written
  } catch { return [] }
}

// env-guard fire-and-forget cho engine: LUCY_VAULT không set / tắt bằng LUCY_DISTILL=0 → no-op.
export function distillCardSafe(card: Card): Promise<DistilledSignal[]> {
  const vault = process.env.LUCY_VAULT
  if (!vault || !fs.existsSync(vault) || process.env.LUCY_DISTILL === '0') return Promise.resolve([])
  return distillCard(vault, card)
}
