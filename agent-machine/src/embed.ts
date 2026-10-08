// embed.ts — Phase 1 vector recall: client embedding Jina (mặc định jina-embeddings-v5-omni-nano, dim 768, đa ngữ 108 thứ tiếng + đa phương thức). Model/dim đổi qua env JINA_EMBED_MODEL/JINA_EMBED_DIM.
// Key lấy từ .env.llm (JINA_API_KEY) — KHÔNG hardcode, KHÔNG echo. Jina lỗi → ném lỗi để recall tự tắt vector.
// Crib loadEnvFile từ llm-lane.ts (cùng cách nạp .env.llm). Embedder injectable → smoke test khỏi cần mạng.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scrubSecrets } from './redact'

let envLoaded = false
function ensureEnv(): void {
  if (envLoaded) return
  envLoaded = true
  const p = process.env.LLM_ENV_FILE || path.join(os.homedir(), 'lucy', '.env.llm')
  try {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const s = line.trim()
      if (!s || s.startsWith('#')) continue
      const eq = s.indexOf('='); if (eq < 0) continue
      const k = s.slice(0, eq).trim()
      if (k && !process.env[k]) process.env[k] = s.slice(eq + 1).trim()
    }
  } catch { /* không có file → key/cfg có thể đã ở process.env sẵn */ }
}
ensureEnv() // nạp .env.llm NGAY lúc import → EMBED_DIM/JINA_MODEL/JINA_API_KEY đọc được khi khởi tạo const

// Model + dim đọc từ env (đổi v3↔v5 không cần sửa code). Mặc định v5-omni-nano (768, đa ngữ + đa phương thức).
// MATRYOSHKA: JINA_EMBED_DIM cắt chiều vector (768→512/384…) qua param `dimensions` của Jina → nhẹ RAM/đĩa
// trên VPS 1.9GB, đổi giá trị này phải REINDEX (vector cũ khác chiều). Vẫn truy hồi tốt nhờ Jina train matryoshka.
export const EMBED_DIM = Number(process.env.JINA_EMBED_DIM) || 768
const JINA_URL = 'https://api.jina.ai/v1/embeddings'
const JINA_RERANK_URL = 'https://api.jina.ai/v1/rerank'
const JINA_MODEL = process.env.JINA_EMBED_MODEL || 'jina-embeddings-v5-omni-nano'
const JINA_RERANK_MODEL = process.env.JINA_RERANK_MODEL || 'jina-reranker-v2-base-multilingual'
const MAX_INPUT_CHARS = 8000 // ~8k token; cắt cho an toàn + rẻ

export type EmbedTask = 'retrieval.passage' | 'retrieval.query'
export type Embedder = (texts: string[], task: EmbedTask) => Promise<number[][]>
// Reranker: xếp lại documents theo độ liên quan với query → trả {index gốc, score} (cao = liên quan hơn).
export type Reranker = (query: string, documents: string[], topN: number) => Promise<{ index: number; score: number }[]>

function loadKey(): string | undefined {
  ensureEnv()
  return process.env.JINA_API_KEY
}

// jinaKey: key tùy chọn cho Jina Reader/Search (r.jina.ai/s.jina.ai) — có key → rate-limit cao hơn, không bắt buộc.
export function jinaKey(): string | undefined { return loadKey() }

// Flag LUCY_VECTOR: '0'/'false' → tắt (thuần FTS5). Mặc định ON nếu có JINA_API_KEY; không có key → coi như tắt.
export function vectorFlagOn(): boolean {
  const f = (process.env.LUCY_VECTOR || '').toLowerCase()
  if (f === '0' || f === 'false' || f === 'off') return false
  return !!loadKey()
}

// Gọi Jina embeddings (batch). Trả mảng vector dim = EMBED_DIM (mặc định 768, cắt được qua JINA_EMBED_DIM).
// Lỗi HTTP/timeout → ném (caller tự tắt vector).
export const jinaEmbed: Embedder = async (texts, task) => {
  const key = loadKey()
  if (!key) throw new Error('JINA_API_KEY chưa cấu hình')
  if (!texts.length) return []
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), Number(process.env.LUCY_EMBED_TIMEOUT_MS) || 20_000)
  try {
    const res = await fetch(JINA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: JINA_MODEL, task, dimensions: EMBED_DIM,
        // BẢO MẬT: scrub secret TRƯỚC khi text rời máy qua API Jina (passage lẫn query).
        input: texts.map((t) => scrubSecrets(t || ' ').slice(0, MAX_INPUT_CHARS) || ' '),
      }),
      signal: ctl.signal,
    })
    if (!res.ok) throw new Error(`Jina ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
    const j = (await res.json()) as { data?: { embedding: number[] }[] }
    const out = (j.data || []).map((d) => d.embedding)
    if (out.length !== texts.length) throw new Error(`Jina trả ${out.length}/${texts.length} vector`)
    return out
  } finally { clearTimeout(timer) }
}

// Flag LUCY_RERANK: '1'/'true'/'on' → bật rerank top-N sau RRF. Mặc định TẮT (thêm 1 call mạng/lượt). Cần JINA_API_KEY.
export function rerankFlagOn(): boolean {
  const f = (process.env.LUCY_RERANK || '').toLowerCase()
  if (!(f === '1' || f === 'true' || f === 'on')) return false
  return !!loadKey()
}

// Gọi Jina reranker. Trả [{index gốc, score}] đã xếp giảm dần. Lỗi/timeout → ném (caller bỏ qua rerank, không chặn).
export const jinaRerank: Reranker = async (query, documents, topN) => {
  const key = loadKey()
  if (!key) throw new Error('JINA_API_KEY chưa cấu hình')
  if (!documents.length) return []
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), Number(process.env.LUCY_RERANK_TIMEOUT_MS) || 15_000)
  try {
    const res = await fetch(JINA_RERANK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: JINA_RERANK_MODEL,
        // BẢO MẬT: scrub secret TRƯỚC khi query/doc rời máy qua API Jina.
        query: scrubSecrets(query || ' ').slice(0, MAX_INPUT_CHARS) || ' ',
        documents: documents.map((d) => scrubSecrets(d || ' ').slice(0, MAX_INPUT_CHARS) || ' '),
        top_n: Math.max(1, Math.min(topN, documents.length)),
      }),
      signal: ctl.signal,
    })
    if (!res.ok) throw new Error(`Jina rerank ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
    const j = (await res.json()) as { results?: { index: number; relevance_score: number }[] }
    return (j.results || []).map((r) => ({ index: r.index, score: r.relevance_score }))
  } finally { clearTimeout(timer) }
}

// Float32 buffer cho sqlite-vec (vec0 nhận BLOB little-endian float32).
export function f32(vec: number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer)
}
