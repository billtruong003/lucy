// aux-client — C3 (Đợt C): side-task (distill/salvage/classify) xài model FREE khi sẵn, thay vì đốt claude.
// Crib Hermes auxiliary_client.py (1 chain resolve cho mọi việc phụ). Né provider đang rate-guard.
// An toàn: không có lane/đều guarded → trả null → caller GIỮ claude (fallback an toàn).
import { callLLM, entryByKey, keyFor, type ChatMsg } from './llm-lane'
import { guardedFor } from './rate-guard'
import { ROUTE_TABLE } from './chat-lane'

/** Key model free tốt-nhất-sẵn-có cho side-task. null nếu không cấu hình / đều bị guard. */
export function auxModelKey(): string | null {
  // ưu tiên fast-classify (rẻ+nhanh) rồi reasoning (cho việc cần suy luận như distill).
  const candidates = [...ROUTE_TABLE['fast-classify'], ...ROUTE_TABLE['reasoning']]
  const seen = new Set<string>()
  for (const k of candidates) {
    if (seen.has(k)) continue
    seen.add(k)
    const e = entryByKey(k)
    if (e && e.free && keyFor(e.provider) && guardedFor(e.provider) === 0) return k
  }
  return null
}

/** Chạy 1 side-task qua lane free. null nếu không có lane / lỗi → caller fallback claude. */
export async function auxComplete(prompt: string, opts: { maxTokens?: number; system?: string } = {}): Promise<string | null> {
  const k = auxModelKey()
  if (!k) return null
  const msgs: ChatMsg[] = []
  if (opts.system) msgs.push({ role: 'system', content: opts.system })
  msgs.push({ role: 'user', content: prompt })
  try {
    const r = await callLLM(k, msgs, { maxTokens: opts.maxTokens ?? 600 })
    return r.content || null
  } catch { return null } // rate-limit/lỗi → null → claude lo
}
