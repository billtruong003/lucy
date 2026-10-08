// bootstrap.ts — đọc ký ức ĐÃ CHỐT (Brain/claude-memory — auto-memory harness redirect về vault),
// rút note nào bản chất là QUY TẮC ỨNG XỬ → brain-signal agent:bootstrap (trust-weight 2 → dream
// graduate ngay) → dream. Dùng bởi bootstrap-cli (tay/sau migrate) + smoke-memory (verify).
import fs from 'node:fs'
import path from 'node:path'
import { runDistillPrompt, type DistilledSignal } from './distill'
import { writeSignal } from './signal'
import { dream, type DreamSummary } from './dream'

export type BootstrapResult = { notes: number; sigs: DistilledSignal[]; dream: DreamSummary | null }

export async function bootstrapFromMemory(vault: string): Promise<BootstrapResult> {
  const memDir = path.join(vault, 'Brain', 'claude-memory')
  let names: string[] = []
  try { names = fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && !/^MEMORY\.md$/i.test(f)) } catch { /* */ }
  if (!names.length) return { notes: 0, sigs: [], dream: null }

  const notes = names.map((f) => `### ${f}\n${fs.readFileSync(path.join(memDir, f), 'utf8').slice(0, 1200)}`).join('\n\n')
  const prompt = [
    `Dưới đây là các ghi chú ký ức của hệ Lucy. Việc của bạn: chọn ra note nào bản chất là QUY TẮC ỨNG XỬ`,
    `tái dùng được (cách làm việc, an toàn, format, quy trình) — KHÔNG phải sự kiện/profile/cấu hình một lần.`,
    ``,
    notes,
    ``,
    `Trả về DUY NHẤT 1 mảng JSON (không chữ nào khác), tối đa 6 phần tử:`,
    `{"topic":"lucy/<pattern-kebab-khong-dau>","signal":"positive|negative","principle":"<quy tắc 1 câu dạng hành động>"}`,
    `- signal "negative" = quy tắc TRÁNH làm gì · "positive" = quy tắc NÊN làm gì.`,
    `- topic = tên pattern chung, không phải tên file.`,
    `- Note là sự kiện/profile/setup (không phải quy tắc) → BỎ QUA. Không có quy tắc nào → trả [].`,
  ].join('\n')

  const sigs = await runDistillPrompt(prompt, 'lucy')
  for (const s of sigs) {
    writeSignal(vault, { topic: s.topic, signal: s.signal, principle: s.principle, cardId: 'bootstrap', agent: 'bootstrap', raw: 'bootstrap từ Brain/claude-memory' })
  }
  return { notes: names.length, sigs, dream: sigs.length ? dream(vault) : null }
}
