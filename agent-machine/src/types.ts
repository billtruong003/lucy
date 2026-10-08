// Lucy Agent Machine — core data model (config-là-DATA, engine generic).

export type Stage = {
  id: string
  name: string
  personaId: string
  gate?: boolean // true => xong stage phải có người DUYỆT mới qua (checkpoint quan trọng)
  verify?: string // lệnh khách quan chạy ở workspace khi agent advance/done; exit≠0 → ép rework (chống false-done). Do OPERATOR khai trong pipeline, KHÔNG phải agent.
}
export type Pipeline = { id: string; name: string; stages: Stage[] }

// Project = container thật: repo (clone được) + board + kênh + chat Lucy riêng.
export type Project = {
  id: string
  name: string
  repoUrl?: string // git repo để agent CLONE & sửa thật (R2). Trống = workspace nháp.
  branch?: string // nhánh làm việc (mặc định nhánh chính)
  description?: string
  skill?: string // SKILL.md domain của dự án (vd Unity/Colyseus) -> chèn vào prompt MỌI agent dự án này
  trashed?: boolean // thùng rác: ẩn khỏi list, chờ purge (xoá hẳn)
  channels: string[] // kênh con Discord-style (R4). Mặc định ['general']
  createdAt: number
  updatedAt: number
}

export type Persona = {
  id: string
  name: string
  avatar?: string // link/upload — gắn được từ prompt cho Lucy hoặc tay
  systemPrompt: string
  model: 'sonnet' | 'opus' // tier Claude khi chạy qua claude -p (runner THẬT). KHÔNG đổi union — runner dùng trực tiếp làm --model.
  allowedTools?: string[] // least-privilege (FS defense)
  timeoutSec?: number
  maxTurns?: number // số turn claude -p được phép (cho agent tự iterate sâu)
  // ── Phân vai + theming (data, không đụng engine) ──
  realm?: string // anime/manga gốc của tên (flavor, hiện ở hub) — vd "Kimetsu no Yaiba"
  kind?: 'orchestrator' | 'specialist' | 'executor' // orchestrator/critic = Claude điều phối; executor = ứng viên lane rẻ
  laneModel?: string // key MODEL_CATALOG (llm-lane) ưu tiên khi chạy lane rẻ — SẴN cho Phase 1.5 wire executor (runner hiện chưa đọc)
  tags?: string[] // nhãn skill (đã dùng trong JSON, giờ first-class)
}

export type CardStatus = 'backlog' | 'queued' | 'working' | 'waiting_human' | 'blocked' | 'parked' | 'done' | 'failed'
export type Cost = { usd: number; inTok: number; outTok: number }

export type Card = {
  id: string
  title: string
  brief: string
  pipelineId: string
  projectId: string // 1 hệ chạy NHIỀU dự án — card thuộc 1 project
  stageIndex: number
  status: CardStatus
  workspace: string // dir cô lập (blast-radius)
  parentId?: string
  depth: number // độ sâu delegate (root=0) — depth-breaker chống delegate vô hạn
  blockedBy: string[] // DAG: card này chờ các card này xong (hold/resume)
  blockKind?: 'dep' | 'delegate' // 'dep' = chờ task khác (start khi xong) · 'delegate' = nhờ con (advance khi xong)
  pendingQuestion?: string
  retryAfter?: number // epoch ms để resume (rate-limit park)
  waitKind?: 'gate' | 'decision' | 'cost' | 'loop' | 'stuck' | 'size-gate' // vì sao đang chờ người: gate duyệt / agent hỏi / vượt cap / lặp quá nhiều / kẹt (stuck-detector) / task quá lớn cần decompose
  modelOverride?: 'sonnet' | 'opus' | 'laneModel' // ép model cho CARD này (đè model mặc định của persona) — orchestrator/bạn chọn
  personaOverride?: string // personaId cho stage ĐẦU (đè pipeline) — chọn ở Board
  reviewNotes?: string[] // feedback khi bạn TRẢ LẠI ở gate -> chèn vào prompt cho agent sửa
  lastSummary?: string // báo cáo bước TRƯỚC -> agent bước sau đọc để nối mạch (D4)
  reports?: { stage: string; persona: string; text: string; ts: number }[] // C1: narrative ĐẦY ĐỦ agent đã làm gì mỗi stage (drawer đọc full, không cụt 1 dòng)
  sessions?: Record<string, string> // CACHE: claude session_id theo persona → rework dùng --resume, KHỎI quét lại project (đỡ token)
  cost: Cost
  sizeGateBypassed?: true // C3: human đã approve bypass size-gate → tick/claim bỏ qua check
  quality?: 'fast' | 'thorough' // B4: 'thorough' = nâng cap (turn/visit/cost) cày tới hoàn thiện, vẫn chịu token-guard hard
  stageVisits?: Record<string, number> // loop-breaker: đếm số lần vào mỗi stage
  artifacts?: { files?: string[]; diffstat?: string; stage?: string; isRepo?: boolean } // báo cáo: file đã tạo/đổi ở stage gần nhất
  history: { ts: number; stage: string; event: string; detail?: string }[]
  createdAt: number
  updatedAt: number
}

export type Decision = 'advance' | 'done' | 'needs_decision' | 'delegate' | 'fail' | 'rework'
export type Outcome = {
  decision: Decision
  summary: string
  question?: string // khi needs_decision
  delegateTo?: { personaId: string; title: string; brief: string; pipelineId?: string } // khi delegate
}
export type RunResult = { outcome: Outcome; cost: Cost; raw: string; report?: string; sessionId?: string; artifacts?: { files?: string[]; diffstat?: string; isRepo?: boolean }; rateLimit?: { retryAfterMs: number; detail: string } }

// DASH-FIX S1: nguồn đốt token (attribution). 'worker' = persona run; còn lại = đường ngoài (B1 cũ chỉ đếm số).
export type LedgerSource = 'worker' | 'autobuild' | 'bridge' | 'hub' | 'lane' | 'cron' | 'autotask' | 'unknown'
// LedgerEntry: thêm source/model/cacheTok (backward-compat — dòng cũ thiếu → readLedger vá source='worker', cacheTok=0).
// cacheTok = TỔNG token cache (read+creation) tách khỏi inTok (inTok giờ = input "tươi", hết gộp cache).
export type LedgerEntry = {
  ts: number; cardId: string; stage: string; persona: string
  source?: LedgerSource; model?: string; cacheTok?: number
} & Cost

export type ChannelKind = 'chat' | 'status' | 'report' | 'decision' | 'system' | 'handoff'
export type ChannelMsg = {
  ts: number
  channel: string
  author: string
  kind: ChannelKind
  text: string
  cardId?: string
}
