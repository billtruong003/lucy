// Budget — guardrail token: cộng dồn theo cửa (5h + tuần), chạm cap → engine PAUSE.
import type { Cost } from './types'

export type BudgetCfg = {
  windowMs: number // cửa rolling chính (vd 5h = 5*3600*1000)
  capUsd: number // ngưỡng cứng trong cửa -> PAUSE
  softUsd?: number // ngưỡng mềm -> cảnh báo
  weeklyMs?: number // cửa tuần (tuỳ chọn)
  weeklyCapUsd?: number // cap tuần
}

export class Budget {
  cfg: BudgetCfg
  events: { ts: number; usd: number }[] = []
  warned = false

  constructor(cfg: BudgetCfg) { this.cfg = cfg }

  add(c: Cost) { this.events.push({ ts: Date.now(), usd: c.usd }) }

  usedIn(ms: number, now = Date.now()): number {
    const from = now - ms
    return this.events.filter((e) => e.ts >= from).reduce((s, e) => s + e.usd, 0)
  }
  usedInWindow(now = Date.now()): number { return this.usedIn(this.cfg.windowMs, now) }

  // ok=false => engine dừng phát card mới (paused)
  check(): { ok: boolean; used: number; soft: boolean; reason?: string } {
    const used = this.usedInWindow()
    const soft = this.cfg.softUsd != null && used >= this.cfg.softUsd
    if (used >= this.cfg.capUsd) {
      return { ok: false, used, soft, reason: `cửa ${(this.cfg.windowMs / 3600000).toFixed(0)}h chạm cap $${this.cfg.capUsd} (đã $${used.toFixed(4)}) → PAUSE` }
    }
    if (this.cfg.weeklyMs && this.cfg.weeklyCapUsd) {
      const wk = this.usedIn(this.cfg.weeklyMs)
      if (wk >= this.cfg.weeklyCapUsd) {
        return { ok: false, used, soft, reason: `cửa tuần chạm cap $${this.cfg.weeklyCapUsd} (đã $${wk.toFixed(4)}) → PAUSE` }
      }
    }
    return { ok: true, used, soft }
  }
}
