// engine-triage — C2 stuck-detector + áp quyết định triage (split/upgrade/escalate).
// Tách RA từ Engine (REFACTOR THUẦN — logic y nguyên). Engine giữ orchestration async (stuckPending/Handled);
// đây là phần THUẦN: phát hiện kẹt + áp quyết định lên card.
import type { Store } from './store'
import { post, threadOf } from './channels'
import type { Card, Stage } from './types'
import type { TriageDecision } from './triage'

/** Phát hiện card kẹt (stuck): rework >= ngưỡng HOẶC visit sắp chạm cap mà vẫn rework. */
export function detectStuck(c: Card, stage: Stage, opts: { handled: boolean; stuckThreshold: number; maxStageVisits: number }): boolean {
  if (opts.handled) return false // đã triage rồi
  const visits = c.stageVisits?.[stage.id] ?? 0
  // (1) rework >= stuckThreshold trên stage này
  if (visits >= opts.stuckThreshold) return true
  // (2) loop-breaker sắp chạm → vẫn rework
  if (visits >= opts.maxStageVisits - 1) {
    const last = [...c.history].reverse().find((h) => h.stage === stage.id)
    if (last && (last.event === 'rework' || last.event === 'verify-fail')) return true
  }
  return false
}

export type CreateSubcard = (title: string, brief: string, pipelineId: string, parentId: string, depth: number, projectId: string) => Card

/** Áp quyết định triage lên card đã reload từ store. Logic y hệt switch cũ trong Engine.triggerStuckTriage. */
export function applyTriageDecision(store: Store, card: Card, stageName: string, decision: TriageDecision, opts: { maxDepth: number; createSubcard: CreateSubcard }): void {
  switch (decision.action) {
    case 'split': {
      // (a) Tạo N subtask → card chính blocked chờ chúng
      const subs = (decision.subtasks || []).slice(0, 3)
      if (!subs.length) {
        // fallback: không có subtask → escalate
        card.status = 'waiting_human'; card.waitKind = 'stuck'
        card.pendingQuestion = `🧩 Triage chọn split nhưng không có subtask cụ thể: ${decision.reason}. Bill xem hướng giải quyết?`
        store.putCard(card)
        return
      }
      // depth-breaker: đã quá sâu → KHÔNG đẻ con nữa, escalate Bill.
      if (card.depth >= opts.maxDepth) {
        card.status = 'waiting_human'; card.waitKind = 'stuck'
        card.pendingQuestion = `🧩 Triage muốn split nhưng đã quá sâu (depth ${card.depth} ≥ ${opts.maxDepth}): ${decision.reason}. Bill xem hướng?`
        store.putCard(card)
        post(store, threadOf(card.id), 'engine', 'system', `⛔ depth-breaker: split quá sâu (depth ${card.depth} ≥ ${opts.maxDepth}) → escalate`, card.id)
        return
      }
      const childIds: string[] = []
      for (const sub of subs) {
        const child = opts.createSubcard(
          sub.title, sub.brief,
          card.pipelineId, card.id, card.depth + 1, card.projectId,
        ) // con ĐỘC LẬP (blockedBy=[]) → queued chạy ngay, KHÔNG bị cha chặn (tránh deadlock)
        childIds.push(child.id)
      }
      // card chính blocked chờ con xong → blockKind='delegate' để khi con xong thì ADVANCE sang stage kế (không re-run stage kẹt)
      card.status = 'blocked'
      card.blockedBy = childIds
      card.blockKind = 'delegate'
      card.history.push({ ts: Date.now(), stage: stageName, event: 'stuck-split', detail: `→ ${subs.length} subtask: ${subs.map((s) => s.title).join(', ')}` })
      post(store, threadOf(card.id), 'engine', 'handoff', `🧩 STUCK → split ${subs.length} subtask: ${subs.map((s) => `"${s.title}"`).join(', ')}`, card.id)
      store.putCard(card)
      // resolveUnblocks có thể chạy subtask ngay
      break
    }
    case 'upgrade': {
      // (b) Nâng model lên opus (chỉ nếu đang sonnet)
      if (card.modelOverride !== 'opus') {
        card.modelOverride = 'opus'
        card.status = 'queued'
        card.stageVisits = {} // reset đếm loop → opus có lượt mới, không bị loop-cap re-stuck ngay
        card.history.push({ ts: Date.now(), stage: stageName, event: 'stuck-upgrade', detail: decision.reason })
        post(store, threadOf(card.id), 'engine', 'system', `⬆ STUCK → nâng lên opus: ${decision.reason}`, card.id)
        store.putCard(card)
      } else {
        // đã opus rồi mà vẫn stuck → escalate
        card.status = 'waiting_human'; card.waitKind = 'stuck'
        card.pendingQuestion = `⬆ Đã opus nhưng vẫn stuck: ${decision.reason}. Bill hướng dẫn?`
        store.putCard(card)
      }
      break
    }
    case 'escalate': {
      // (c) Escalate Bill
      card.status = 'waiting_human'; card.waitKind = 'stuck'
      card.pendingQuestion = `🧩 STUCK — ${decision.reason}`
      post(store, threadOf(card.id), 'engine', 'decision', `📢 ESCALATE: ${decision.reason}`, card.id)
      store.putCard(card)
      break
    }
  }
}
