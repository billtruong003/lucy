// tool-hooks.ts — SDK hooks + canUseTool cho ClaudeRunner (CL-1).
// ADDITIVE & FLAG-GATED qua LUCY_HOOKS (mặc định OFF → buildHookOptions trả {} → path cũ y nguyên).
//
// Lucy chạy permissionMode:'bypassPermissions' → mù: không guard lệnh nguy, không telemetry per-tool.
// Module này vá 2 lỗ, chạy IN-PROCESS (token=0, KHÔNG vào context lượt hiện tại):
//   1) GUARD: PreToolUse chặn Bash nguy hiểm (git push / rm -rf / path nhạy cảm…). Dưới bypassPermissions
//      canUseTool KHÔNG được gọi → PreToolUse mới là chốt chặn THẬT; canUseTool giữ làm phòng-thủ-tầng-2
//      (khi đổi permissionMode). Tái dùng nguyên danh sách DANGER của auto-task.py / auto-build.py.
//   2) TELEMETRY: PostToolUse fire-and-forget append JSONL (tool name, ok/err, duration) — pattern y hệt
//      FileTurnLogger, nuốt lỗi ghi, KHÔNG block turn, KHÔNG tự chế schema endpoint mới.
import fs from 'node:fs'
import path from 'node:path'

// ── DANGER — copy NGUYÊN từ auto-task.py (vốn copy từ auto-build.py), KHÔNG nới lỏng ──
const DANGER: RegExp[] = [
  /rm\s+-rf\s+(\/|~|\$HOME|\*)/,
  /\bgit\s+push/,
  /pm2\s+(restart|stop|delete|reload)\s+\S*bridge/,
  /\bmkfs/,
  /\bdd\s+if=/,
  /:\(\)\s*\{/,
  />\s*\/dev\/sd/,
  /chmod\s+-R?\s*777\s+\//,
  /\b(shutdown|reboot|halt)\b/,
  /rm\s+-rf\s+\/root\/lucy\b/,
  /\bcurl[^|]*\|\s*(ba)?sh/,
]

// Trả lý do (chuỗi) nếu lệnh nguy hiểm, null nếu an toàn. Dùng cho cả PreToolUse và canUseTool.
export function dangerousBash(cmd: string): string | null {
  for (const p of DANGER) {
    if (p.test(cmd)) return `match ${p.source}`
  }
  return null
}

// Đường ghi telemetry: env LUCY_HOOKS_LOG, fallback AM_TURNS_LOG (cùng thư mục turn-log), cuối cùng cwd.
function telemetryFile(): string {
  const dir = process.env.LUCY_HOOKS_LOG || process.env.AM_TURNS_LOG
  if (dir) {
    try { fs.mkdirSync(dir, { recursive: true }) } catch { /* sink phụ — bỏ qua */ }
    return path.join(dir, 'tool-telemetry.jsonl')
  }
  return path.join(process.cwd(), 'tool-telemetry.jsonl')
}

// Fire-and-forget append 1 dòng JSONL. Nuốt lỗi (telemetry không critical, không hỏng turn).
function emit(rec: Record<string, unknown>): void {
  try {
    fs.appendFileSync(telemetryFile(), JSON.stringify(rec) + '\n')
  } catch { /* không critical */ }
}

// Context tĩnh để gắn nhãn telemetry theo lượt chạy (card/persona/stage). Không bắt buộc.
export interface HookContext {
  task?: string
  agent?: string
  stage?: string
}

// Bóc command từ tool_input (unknown) một cách an toàn — không giả định shape.
function bashCommand(input: unknown): string {
  if (input && typeof input === 'object' && 'command' in input) {
    const c = (input as { command?: unknown }).command
    if (typeof c === 'string') return c
  }
  return ''
}

// buildHookOptions — trả mảnh options { hooks, canUseTool } để spread vào query().options.
// LUCY_HOOKS chưa bật → trả {} (KHÔNG đổi hành vi runner cũ một chút nào).
export function buildHookOptions(ctx: HookContext = {}): Record<string, unknown> {
  if (process.env.LUCY_HOOKS !== '1') return {}

  // PreToolUse: chốt guard THẬT dưới bypassPermissions. Deny Bash nguy hiểm + ghi telemetry blocked.
  const preToolUse = async (input: unknown): Promise<Record<string, unknown>> => {
    const i = input as { tool_name?: string; tool_input?: unknown }
    if (i?.tool_name === 'Bash') {
      const cmd = bashCommand(i.tool_input)
      const reason = dangerousBash(cmd)
      if (reason) {
        emit({ ...ctx, kind: 'block', tool: 'Bash', cmd: cmd.slice(0, 200), reason })
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `LUCY_HOOKS CHẶN lệnh nguy hiểm (${reason}).`,
          },
        }
      }
    }
    return {} // allow — không can thiệp
  }

  // PostToolUse: telemetry per-tool (tool name, ok/err, duration). KHÔNG trả additionalContext
  // → KHÔNG nhét gì vào context lượt hiện tại (tránh phình token).
  const postToolUse = async (input: unknown): Promise<Record<string, unknown>> => {
    const i = input as { tool_name?: string; tool_response?: unknown; duration_ms?: number }
    const resp = i?.tool_response as { is_error?: boolean } | undefined
    emit({
      ...ctx,
      kind: 'tool',
      tool: i?.tool_name ?? '?',
      ok: !(resp && resp.is_error === true),
      duration_ms: i?.duration_ms ?? null,
    })
    return {}
  }

  // canUseTool: phòng-thủ-tầng-2 (chỉ được gọi khi KHÔNG bypassPermissions). Cùng guard Bash.
  const canUseTool = async (toolName: string, toolInput: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (toolName === 'Bash') {
      const reason = dangerousBash(bashCommand(toolInput))
      if (reason) return { behavior: 'deny', message: `LUCY_HOOKS CHẶN lệnh nguy hiểm (${reason}).` }
    }
    return { behavior: 'allow' }
  }

  return {
    hooks: {
      PreToolUse: [{ hooks: [preToolUse] }],
      PostToolUse: [{ hooks: [postToolUse] }],
    },
    canUseTool,
  }
}
