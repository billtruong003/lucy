// CL-3 — Cầu Registry ↔ MCP: 1 HANDLER, 2 ĐẦU RA.
// Tool khai báo MỘT lần trong CL-2 registry (registry.ts + lane-tools.ts) → chạy được ở:
//   • lane (tool-call OpenAI)   : getLaneToolDefs(toolset) + dispatchTool()  (ĐÃ có ở CL-2)
//   • claude (MCP in-process)   : registryMcpServer(toolset, ctx) — adapter file NÀY
// Cùng e.handler, cùng sanitizeError → hết viết tool 2 chỗ.
//
// AN TOÀN LIVE: file chỉ EXPOSE adapter, KHÔNG tự mount. mcp-registry.ts quyết định mount
// qua spec id='registry' (status='scaffold' → mặc định TẮT kể cả khi LUCY_MCP=1; bật bằng LUCY_MCP_REGISTRY=on).
// KHÔNG import mcp-registry.ts (tránh vòng): mcp-registry import file này, không ngược lại.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { registry, dispatchTool, type ToolCtx } from './registry'
import { registerLaneTools } from './lane-tools'

// SDK config record (giữ lỏng kiểu — khớp McpServerConfig của mcp-registry mà không phụ thuộc nó).
type McpServerConfig = Record<string, unknown>
const T = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })

// ── JSON Schema (registry e.schema) → Zod raw shape (tool() của SDK cần ZodRawShape) ──
// Registry chỉ dùng schema phẳng: object{ properties: {k:{type,description}}, required:[] }.
type JSchema = { type?: string; description?: string; properties?: Record<string, JSchema>; required?: string[] }

function zodForProp(p: JSchema): z.ZodTypeAny {
  let base: z.ZodTypeAny
  switch (p?.type) {
    case 'number':
    case 'integer': base = z.number(); break
    case 'boolean': base = z.boolean(); break
    case 'array': base = z.array(z.any()); break
    case 'object': base = z.record(z.string(), z.any()); break
    default: base = z.string()
  }
  if (p?.description) base = base.describe(String(p.description))
  return base
}

export function jsonSchemaToZodShape(schema: Record<string, unknown> | undefined): Record<string, z.ZodTypeAny> {
  const s = (schema || {}) as JSchema
  const props = s.properties || {}
  const req = new Set(s.required || [])
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [k, v] of Object.entries(props)) {
    let zt = zodForProp(v as JSchema)
    if (!req.has(k)) zt = zt.optional()
    shape[k] = zt
  }
  return shape
}

// ── adapter chính: toolset registry → 1 SDK in-process MCP server ──
// ctx.mode mặc định 'runner' (bó workspace, an toàn hơn 'chat' cho phép path tuyệt đối).
// allowed=undefined → fs handler KHÔNG gate per-tool (least-privilege của lane-runner chỉ áp khi có allowed);
// path vẫn bị resolveRunner bó trong ctx.ws → không thoát workspace.
export function registryMcpServer(
  toolsets: string[],
  ctx: ToolCtx,
  opts: { name?: string; version?: string } = {},
): McpServerConfig | null {
  registerLaneTools() // bảo đảm registry đã nạp (idempotent) trước khi resolve
  const names = [...new Set(toolsets.flatMap((t) => registry.resolveToolset(t)))]
  if (!names.length) return null
  const tools = names.map((n) => {
    const e = registry.getEntry(n)! // resolveToolset chỉ trả tool đã đăng ký + available
    return tool(
      e.name,
      e.description,
      jsonSchemaToZodShape(e.schema),
      async (args: Record<string, unknown>) => T(await dispatchTool(e.name, args, ctx)),
    )
  })
  return createSdkMcpServer({
    name: opts.name || 'lucytools',
    version: opts.version || '1.0.0',
    tools,
  }) as unknown as McpServerConfig
}

// ── tiện ích "1 handler 2 đầu ra" (cho smoke/doc) — cùng toolset ra cả 2 path ──
export function registryBothPaths(toolsets: string[], ctx: ToolCtx) {
  return {
    laneDefs: [...new Set(toolsets.flatMap((t) => registry.resolveToolset(t)))]
      .map((n) => registry.toolDef(n)).filter((d): d is NonNullable<typeof d> => !!d),
    mcpServer: registryMcpServer(toolsets, ctx),
  }
}

// Toolset no-auth mặc định cho thử nghiệm MCP-from-registry (web + đọc/ghi file workspace).
// KHÔNG gồm 'bash' (nguy) — muốn thêm thì sửa spec build ở mcp-registry.ts.
export const REGISTRY_MCP_DEFAULT_TOOLSETS = ['web', 'fs-rw']
