// prompt-architect-store — CỤM A / Task 5: lưu LỊCH SỬ phiên Prompt Architect.
// Mỗi phiên: ngữ cảnh đầu vào + câu hỏi (đã xuất) + prompt cuối + bản edit của chủ nhân.
// ADDITIVE + AN TOÀN: sidecar DB riêng `<vault>/.index/prompt-architect.db` (KHÔNG đụng memory.db live).
// Theo chuẩn Recall (better-sqlite3 + WAL). Ghi async/fire-safe — lỗi ghi KHÔNG được làm gãy chat.
// BẢO MẬT: scrub secret trước khi lưu (backstop, phòng caller bỏ sót).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'
import { scrubSecrets } from './redact'

export type PromptSession = {
  id: number
  ts: number
  source: string        // tg | hub | cli
  chatId: string
  targetModel: string   // model đích prompt sẽ chạy (nếu biết)
  contextInput: string  // ngữ cảnh thô chủ nhân dán
  clarifyAsked: string  // câu hỏi làm-rõ persona đã hỏi (rỗng nếu đi thẳng)
  finalPrompt: string   // prompt cuối persona xuất
  userEdit: string      // bản chủ nhân sửa lại (nếu có)
  laneModel: string     // model rẻ đã dùng để dựng (vd ds-chat)
  escalated: number     // 1 nếu phiên này đã escalate sang Claude
}

// vault dir: ưu tiên opts → LUCY_VAULT → ~/lucy/lucy-vault. Resolve 1 lần.
function resolveVaultDir(vaultDir?: string): string {
  const v = vaultDir || process.env.LUCY_VAULT || path.join(os.homedir(), 'lucy', 'lucy-vault')
  return path.resolve(v)
}

export class PromptArchitectStore {
  readonly dbPath: string
  private db: Database.Database

  constructor(vaultDir?: string) {
    const base = resolveVaultDir(vaultDir)
    const indexDir = path.join(base, '.index')
    fs.mkdirSync(indexDir, { recursive: true })
    this.dbPath = path.join(indexDir, 'prompt-architect.db')
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions(
        id INTEGER PRIMARY KEY,
        ts REAL,
        source TEXT, chat_id TEXT, target_model TEXT,
        context_input TEXT, clarify_asked TEXT, final_prompt TEXT,
        user_edit TEXT, lane_model TEXT, escalated INTEGER DEFAULT 0);
      CREATE INDEX IF NOT EXISTS idx_pa_ts ON sessions(ts);
      CREATE INDEX IF NOT EXISTS idx_pa_chat ON sessions(chat_id);
    `)
  }

  // Ghi 1 phiên. Content scrub secret + cắt 16000 ký tự/field. Trả id hoặc null (lỗi → null, KHÔNG nổ).
  recordSession(s: {
    source?: string; chatId?: string; targetModel?: string;
    contextInput?: string; clarifyAsked?: string; finalPrompt?: string;
    userEdit?: string; laneModel?: string; escalated?: boolean; ts?: number
  }): number | null {
    try {
      const cap = (v?: string) => scrubSecrets((v || '').trim()).slice(0, 16000)
      const info = this.db.prepare(`
        INSERT INTO sessions(ts, source, chat_id, target_model, context_input, clarify_asked, final_prompt, user_edit, lane_model, escalated)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(
        s.ts ?? Date.now(), s.source || '', s.chatId || '', s.targetModel || '',
        cap(s.contextInput), cap(s.clarifyAsked), cap(s.finalPrompt),
        cap(s.userEdit), s.laneModel || '', s.escalated ? 1 : 0,
      )
      return Number(info.lastInsertRowid)
    } catch { return null }
  }

  // Cập nhật bản edit của chủ nhân lên 1 phiên đã lưu (rewrite-then-edit). Trả true nếu đổi 1 dòng.
  recordUserEdit(id: number, userEdit: string): boolean {
    try {
      const info = this.db.prepare('UPDATE sessions SET user_edit = ? WHERE id = ?')
        .run(scrubSecrets((userEdit || '').trim()).slice(0, 16000), id)
      return info.changes > 0
    } catch { return false }
  }

  // Đánh dấu 1 phiên đã escalate sang Claude.
  markEscalated(id: number): boolean {
    try { return this.db.prepare('UPDATE sessions SET escalated = 1 WHERE id = ?').run(id).changes > 0 }
    catch { return false }
  }

  // Lịch sử gần nhất (cho tab/cụm B đọc lại). limit cap 50.
  recent(opts: { chatId?: string; limit?: number } = {}): PromptSession[] {
    try {
      const limit = Math.max(1, Math.min(opts.limit ?? 10, 50))
      const where = opts.chatId ? 'WHERE chat_id = ?' : ''
      const params: unknown[] = opts.chatId ? [opts.chatId, limit] : [limit]
      return this.db.prepare(`
        SELECT id, ts, source, chat_id AS chatId, target_model AS targetModel,
               context_input AS contextInput, clarify_asked AS clarifyAsked, final_prompt AS finalPrompt,
               user_edit AS userEdit, lane_model AS laneModel, escalated
        FROM sessions ${where} ORDER BY ts DESC LIMIT ?
      `).all(...params) as PromptSession[]
    } catch { return [] }
  }

  stats(): { sessions: number } {
    try { return { sessions: (this.db.prepare('SELECT COUNT(*) c FROM sessions').get() as { c: number }).c } }
    catch { return { sessions: 0 } }
  }

  close() { try { this.db.close() } catch { /* */ } }
}

// Singleton tiện cho caller fire-and-forget (mở 1 lần/process). null nếu mở lỗi.
let _store: PromptArchitectStore | null | undefined
export function getPromptArchitectStore(vaultDir?: string): PromptArchitectStore | null {
  if (_store !== undefined) return _store
  try { _store = new PromptArchitectStore(vaultDir) } catch { _store = null }
  return _store
}
