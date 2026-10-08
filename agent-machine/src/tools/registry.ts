// CL-2 — Tool Registry thống nhất (kiểu Hermes tools/registry.py) cho Lucy.
// 1 NGUỒN khai báo tool: name + toolset + schema + handler (+ checkFn/requiresEnv/emoji).
// Mục tiêu: viết handler MỘT lần → lane-chat & lane-runner đọc ToolDef từ registry thay vì hard-code 2 chỗ.
// AN TOÀN: flag LUCY_TOOL_REGISTRY MẶC ĐỊNH TẮT → lane đọc đường cũ (forward-only, không vỡ live).
//
// Import chain chống vòng (giống Hermes): registry.ts KHÔNG import file tool nào;
// các file tool (lane-tools.ts) import registry.ts ở top-level và gọi register() khi nạp module.
import type { ToolDef } from '../llm-lane'

// Bối cảnh 1 lần gọi tool. mode quyết định luật sandbox (chat = path tuyệt đối + blacklist nhạy cảm;
// runner = bó trong workspace + gate theo persona.allowedTools). 1 handler, 2 luật — giữ nguyên hành vi cũ.
export interface ToolCtx {
  ws: string
  mode: 'chat' | 'runner'
  allowed?: Set<string>   // runner: quyền persona (Read/Write/Edit/Bash) để gate tool
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string> | string

export interface ToolEntry {
  name: string
  toolset: string                       // nhóm tool (vd 'web' | 'fs-rw' | 'market' | 'consult')
  schema: Record<string, unknown>       // = function.parameters (JSON Schema OpenAI)
  description: string
  handler: ToolHandler
  checkFn?: () => boolean                // chỉ hiện tool khi true (vd đủ điều kiện runtime)
  requiresEnv?: string[]                 // thiếu env → tool coi như không khả dụng
  emoji?: string
  maxResultChars?: number
}

// ───────────────── sanitize lỗi (Hermes: LUÔN trả lỗi gọn, cắt framing XML/CDATA/fence) ─────────────────
export function sanitizeError(raw: string, cap = 300): string {
  return String(raw ?? '')
    .replace(/<!\[CDATA\[|\]\]>/g, ' ')
    .replace(/```+/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')   // strip thẻ XML/HTML framing
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap)
}

class ToolRegistry {
  private tools = new Map<string, ToolEntry>()
  private toolsets = new Map<string, string[]>()   // tên toolset → thành viên (tên tool HOẶC tên toolset lồng)
  private aliases = new Map<string, string>()

  // register idempotent: gọi lại (cùng tên) ghi đè — an toàn khi nhiều module nạp registerLaneTools().
  register(e: ToolEntry): void {
    if (!e.name) throw new Error('ToolEntry thiếu name')
    this.tools.set(e.name, e)
  }

  registerToolset(name: string, members: string[]): void {
    this.toolsets.set(name, members)
  }

  registerAlias(alias: string, target: string): void {
    this.aliases.set(alias, target)
  }

  getEntry(name: string): ToolEntry | undefined { return this.tools.get(name) }
  has(name: string): boolean { return this.tools.has(name) }
  allNames(): string[] { return [...this.tools.keys()] }

  // 1 tool khả dụng khi: đủ env (requiresEnv) + checkFn() (nếu khai). Lỗi checkFn → coi như tắt.
  available(name: string): boolean {
    const e = this.tools.get(name)
    if (!e) return false
    if (e.requiresEnv?.some((k) => !process.env[k])) return false
    if (e.checkFn) { try { if (!e.checkFn()) return false } catch { return false } }
    return true
  }

  // resolve toolset → danh sách TÊN TOOL phẳng, đệ quy toolset lồng, chống lặp vòng + dedup, lọc available.
  // name có thể là alias → toolset → (tool | toolset lồng). Nếu name là 1 tool đã đăng ký thì trả [name].
  resolveToolset(name: string, seen = new Set<string>()): string[] {
    const target = this.aliases.get(name) ?? name
    if (seen.has(target)) return []            // vòng → cắt
    seen.add(target)
    const members = this.toolsets.get(target)
    if (!members) {
      // không phải toolset → coi là tên tool đơn
      return this.tools.has(target) && this.available(target) ? [target] : []
    }
    const out: string[] = []
    for (const m of members) {
      for (const t of this.resolveToolset(m, seen)) if (!out.includes(t)) out.push(t)
    }
    return out
  }

  toolDef(name: string): ToolDef | undefined {
    const e = this.tools.get(name)
    if (!e) return undefined
    return { type: 'function', function: { name: e.name, description: e.description, parameters: e.schema } }
  }

  // ToolDef[] (định dạng OpenAI tool-calling) cho lane — resolve toolset rồi map. Giữ thứ tự đăng ký.
  laneToolDefs(toolset: string): ToolDef[] {
    return this.resolveToolset(toolset).map((n) => this.toolDef(n)).filter((d): d is ToolDef => !!d)
  }

  // dispatch: chạy handler theo tên, try/catch → LUÔN trả string (lane nuốt string). Lỗi → 'ERROR: <sanitized>'.
  async dispatch(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
    const e = this.tools.get(name)
    if (!e) return `ERROR: tool lạ "${name}"`
    try {
      const r = await e.handler(args, ctx)
      return typeof r === 'string' ? r : String(r ?? '')
    } catch (err) {
      return 'ERROR: ' + sanitizeError(err instanceof Error ? err.message : String(err))
    }
  }

  // Manifest self-awareness: block ngắn "Lucy biết mình có tool gì". STATIC → nạp vào prefix prompt (giữ cache).
  manifest(toolsets?: string[]): string {
    const names = toolsets?.length
      ? [...new Set(toolsets.flatMap((t) => this.resolveToolset(t)))]
      : this.allNames().filter((n) => this.available(n))
    if (!names.length) return ''
    const lines = names.map((n) => {
      const e = this.tools.get(n)!
      const desc = (e.description.split(/(?<=\.)\s|[.\n]/)[0] || e.description).slice(0, 90)
      return `• ${e.emoji ? e.emoji + ' ' : ''}${e.name} — ${desc}`
    })
    return `\n\n---\n🧰 TOOL EM CÓ (tự thực thi được, đừng nói "không làm được"):\n${lines.join('\n')}`
  }
}

// singleton
export const registry = new ToolRegistry()

// ───────────────── flag + tiện ích export ─────────────────
export function toolRegistryEnabled(): boolean {
  const f = (process.env.LUCY_TOOL_REGISTRY || '').toLowerCase()
  return f === '1' || f === 'true' || f === 'on'
}

export function getLaneToolDefs(toolset: string): ToolDef[] { return registry.laneToolDefs(toolset) }
export function dispatchTool(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  return registry.dispatch(name, args, ctx)
}
export function getToolManifest(toolsets?: string[]): string { return registry.manifest(toolsets) }
