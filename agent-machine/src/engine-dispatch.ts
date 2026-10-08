// engine-dispatch — chọn model+persona THỰC cho 1 job vừa claim. Tách RA từ Engine.claim()
// (REFACTOR THUẦN — logic y nguyên, không đổi hành vi). Engine giữ vòng đời; đây là "dispatch".
import type { Card, Persona, Project } from './types'
import type { TokenGuard } from './token-guard'
import { cheapestAvailableLaneKey } from './llm-lane'

// Resolve persona hiệu lực cho job: áp model-override (không hạ cấp stage mạnh), skill dự án,
// token-guard soft (hạ executor xuống lane rẻ), và B4 thorough (nhân maxTurns).
// Thuần theo input — đọc tokenGuard.check() (read-only). Hành vi y hệt code cũ trong claim().
export function resolveExecutionPersona(base: Persona, c: Card, proj: Project | undefined, tokenGuard: TokenGuard | null, thorough: boolean): Persona {
  // model: override per-card NHƯNG không HẠ CẤP stage mạnh — reviewer/architect default opus thì GIỮ opus
  // (chống "coder sonnet review chính mình"). Override chỉ nâng sonnet->opus, không hạ opus->sonnet.
  // 'laneModel' = dùng model rẻ của persona (laneModel field) — KHÔNG đè persona.model
  const model = c.modelOverride && c.modelOverride !== 'laneModel' ? (base.model === 'opus' ? 'opus' : c.modelOverride) : base.model
  let persona = model !== base.model ? { ...base, model } : base
  // explicit claude model (opus/sonnet) → bỏ lane để ClaudeRunner chạy đúng model, không ngầm rơi xuống lane rẻ
  if (c.modelOverride === 'opus' || c.modelOverride === 'sonnet') persona = { ...persona, laneModel: undefined }
  if (proj?.skill) persona = { ...persona, systemPrompt: persona.systemPrompt + `\n\n--- SKILL DỰ ÁN "${proj.name}" ---\n${proj.skill}` }
  // TokenGuard: soft limit → ép EXECUTOR xuống lane rẻ nhất để tiết kiệm.
  // GAP#3: CHỈ hạ executor (kind='executor') — KHÔNG hạ reviewer/architect (opus)
  // để giữ chất lượng gate ("coder rẻ không tự review chính mình").
  // FIX 2026-06-18: KHÔNG hạ nếu Bill explicit request opus/sonnet (đã clear laneModel ở trên).
  // Bug cũ: isExecutor dùng persona.laneModel (đã clear ở step 1) → true → soft guard ÉP LẠI → Opus bị chặn.
  const isExecutor = base.kind === 'executor' && !c.modelOverride
  if (tokenGuard && isExecutor) {
    const ts = tokenGuard.check()
    if (ts.soft) {
      const cheapKey = cheapestAvailableLaneKey()
      if (cheapKey) {
        persona = { ...persona, laneModel: cheapKey }
        console.log(`[engine] token-guard SOFT — hạ executor "${persona.name}" xuống lane ${cheapKey} (used=${ts.used}/${ts.softLimit})`)
      }
    }
  }
  // B4 quality-first: card 'thorough' → cho agent nhiều turn hơn (cày sâu, chấp nhận đốt token).
  if (thorough) persona = { ...persona, maxTurns: (persona.maxTurns ?? 12) * 2 }
  return persona
}
