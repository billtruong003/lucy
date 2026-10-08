// ⚠️ 4 FILE "lane" tên gần giống — ĐỪNG sửa nhầm: lane-chat=vòng agentic tool cho chat (file này) ·
//    chat-lane=routing+chat primitive · lane-runner=chạy 1 stage card · llm-lane=lát API provider.
// lane-chat.ts — Phase M: vòng AGENTIC cho LANE model trong CHAT (không phải card pipeline).
// Cho model rẻ "biết dùng máy/web" như Hermes: web_search · web_fetch · read_file · list_dir · bash · write_file · edit_file.
// File tools KHÔNG sandbox workspace — model đọc/sửa bất kỳ path nào NGOẠI TRỪ blacklist nhạy cảm (.ssh, secrets...).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { callLLMRaw, RateLimitError, type ToolDef, type RawMsg } from './llm-lane'
import { webFetch, webSearch } from './web-tools'
import { readAgentBrain } from './agent-brain'   // K2: nạp não nghề của expert khi consult
// CL-2: tool registry thống nhất (flag LUCY_TOOL_REGISTRY, default OFF → vẫn dùng CHAT_TOOLS/execChatTool cũ).
import { registry, toolRegistryEnabled, getLaneToolDefs, dispatchTool } from './tools/registry'
import { registerLaneTools } from './tools/lane-tools'

export const CHAT_TOOLS: ToolDef[] = [
  { type: 'function', function: { name: 'web_search', description: 'Tìm web (DuckDuckGo) → top kết quả {tiêu đề, URL}. Dùng để research/tra thông tin mới.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'web_fetch', description: 'Lấy nội dung 1 URL (text). Dùng sau web_search để đọc trang cụ thể.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'read_file', description: 'Đọc file bất kỳ trên hệ thống (path tuyệt đối hoặc tương đối từ workspace). Ưu tiên path tuyệt đối khi biết chắc.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path tuyệt đối (ví dụ /root/lucy/hub/server/src/index.ts) hoặc tương đối từ workspace' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'list_dir', description: 'Liệt kê thư mục (path tuyệt đối hoặc tương đối).', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path thư mục, mặc định = workspace' } } } } },
  { type: 'function', function: { name: 'bash', description: 'Chạy lệnh shell (có thể dùng path tuyệt đối). KHÔNG git push, KHÔNG xoá hàng loạt, KHÔNG echo/cat secrets.', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } } },
  { type: 'function', function: { name: 'write_file', description: 'Ghi/tạo file (path tuyệt đối hoặc tương đối từ workspace).', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'edit_file', description: 'Thay old_string → new_string trong file (path tuyệt đối hoặc tương đối). Dùng khi chỉ cần sửa 1 đoạn nhỏ.', parameters: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'] } } },
]

// Blacklist path nhạy cảm — block đọc/ghi các file này dù dùng path tuyệt đối
const SENSITIVE_PATTERNS = [
  /\/\.ssh\//,
  /\/\.gnupg\//,
  /[/.]env$/,           // .env, *.env (chứa secrets)
  /\.env\./,            // .env.local, .env.production
  /private[_-]?key/i,
  /secret[_-]?key/i,
  /id_rsa/,
  /id_ed25519/,
  /credentials\.json/i,
]
function isSensitive(p: string): boolean {
  return SENSITIVE_PATTERNS.some(rx => rx.test(p))
}

// Resolve path: absolute = dùng nguyên, relative = resolve từ ws
function resolvePath(ws: string, p: string): string {
  const r = path.isAbsolute(p) ? path.normalize(p) : path.resolve(ws, p || '.')
  if (isSensitive(r)) throw new Error(`path nhạy cảm bị chặn: ${r}`)
  return r
}

function runBash(cmd: string, ws: string, timeoutMs = 60000): Promise<string> {
  return new Promise((resolve) => {
    const ch = spawn('bash', ['-lc', cmd], { cwd: ws, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const t = setTimeout(() => ch.kill(), timeoutMs)
    ch.stdout.on('data', (d) => (out += d)); ch.stderr.on('data', (d) => (out += d))
    ch.on('close', (code) => { clearTimeout(t); resolve((out || '').slice(0, 8000) + (code ? `\n[exit ${code}]` : '')) })
    ch.on('error', (e) => { clearTimeout(t); resolve('ERROR bash: ' + String(e).slice(0, 200)) })
  })
}
const S = (a: Record<string, unknown>, k: string) => String(a[k] ?? '')

// K2 — consult_expert: hỏi 1 persona chuyên lĩnh vực (sub-agent persona+brain). #3: hiện thành tool-card.
const CONSULT_TOOL: ToolDef = { type: 'function', function: { name: 'consult_expert', description: 'Hỏi 1 EXPERT chuyên lĩnh vực để tổng hợp thông tin rồi bạn dệt vào câu trả lời. Dùng khi cần góc chuyên sâu ngoài thế mạnh của bạn.', parameters: { type: 'object', properties: { persona: { type: 'string', description: 'id expert (chọn đúng lĩnh vực): finance(tài chính/thị trường) | marketing(growth) | researcher(nghiên cứu/tổng hợp) | designer(UI/UX) | data(dữ liệu/scrape) | architect(kiến trúc/plan) | engineer(code/bugfix) | security(bảo mật/audit) | investigator(điều tra root-cause/debug) | devops(deploy/CI) | tester(QA/chiến lược test) | writer(viết nội dung/docs)' }, question: { type: 'string', description: 'câu hỏi/yêu cầu cụ thể cho expert' } }, required: ['persona', 'question'] } } }

function personaDirs(): string[] {
  const c: string[] = []
  if (process.env.LUCY_PERSONA_DIR) c.push(process.env.LUCY_PERSONA_DIR.replace(/^~/, os.homedir()))
  c.push(path.join(process.cwd(), 'config', 'personas'))
  c.push(path.join(os.homedir(), 'lucy', 'agent-machine', 'config', 'personas'))
  return c
}
function loadPersona(id: string): { id: string; name: string; systemPrompt: string; laneModel?: string } | null {
  const safe = id.replace(/[^a-z0-9_-]/gi, '')
  for (const d of personaDirs()) {
    try { const p = path.join(d, safe + '.json'); if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { /* */ }
  }
  return null
}
export async function consultExpert(personaId: string, question: string, ws: string): Promise<string> {
  const p = loadPersona(personaId)
  if (!p) return `ERROR: không có expert "${personaId}". Thử: finance, marketing, researcher, designer, data, architect, engineer, security, investigator, devops, tester, writer.`
  let brain = ''
  try { brain = readAgentBrain(p.id) || '' } catch { /* */ }
  const sys = `${p.systemPrompt}${brain ? '\n\n--- NÃO NGHỀ (đã học) ---\n' + brain : ''}\n\n(Bạn được Lucy hỏi tư vấn. Trả lời GỌN, chất, dùng tool nếu cần. KHÔNG hỏi lại — tổng hợp tốt nhất có thể.)`
  // sub-agent: allowConsult=false (chặn đệ quy consult), maxTurns nhỏ
  const sub = await chatLaneAgentic(p.laneModel || 'or-nemotron-super', [{ role: 'system', content: sys }, { role: 'user', content: question }], ws, { allowConsult: false, maxTurns: 6 })
  return `[Expert ${p.name}]\n${sub.answer}`
}

// CL-2: nạp tool lane vào registry + đăng ký consult_expert (handler ở đây để tránh import vòng lane-tools↔lane-chat).
let chatRegistered = false
function ensureChatRegistered(): void {
  if (chatRegistered) return
  chatRegistered = true
  registerLaneTools()
  registry.register({
    name: 'consult_expert', toolset: 'consult', emoji: '🧑‍🔬',
    description: CONSULT_TOOL.function.description,
    schema: CONSULT_TOOL.function.parameters,
    handler: (a, ctx) => consultExpert(S(a, 'persona'), S(a, 'question'), ctx.ws),
  })
}

async function execChatTool(name: string, a: Record<string, unknown>, ws: string): Promise<string> {
  switch (name) {
    case 'consult_expert': return await consultExpert(S(a, 'persona'), S(a, 'question'), ws)
    case 'web_search': return await webSearch(S(a, 'query'))
    case 'web_fetch': return await webFetch(S(a, 'url'))
    case 'read_file': { const p = resolvePath(ws, S(a, 'path')); const c = fs.readFileSync(p, 'utf8'); return c.length > 20000 ? c.slice(0, 20000) + '\n…(cắt)' : c }
    case 'list_dir': { const d = resolvePath(ws, S(a, 'path') || '.'); return fs.readdirSync(d, { withFileTypes: true }).map((e) => e.isDirectory() ? e.name + '/' : e.name).join('\n') || '(rỗng)' }
    case 'bash': return await runBash(S(a, 'cmd'), ws)
    case 'write_file': { const p = resolvePath(ws, S(a, 'path')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, S(a, 'content')); return `đã ghi ${p}` }
    case 'edit_file': { const p = resolvePath(ws, S(a, 'path')); const cur = fs.readFileSync(p, 'utf8'); const o = S(a, 'old_string'); if (!cur.includes(o)) return `ERROR: không thấy old_string trong ${p}`; fs.writeFileSync(p, cur.replace(o, S(a, 'new_string'))); return `đã sửa ${p}` }
    default: return `ERROR: tool lạ "${name}"`
  }
}

export const CHAT_LANE_NOTE = `

---
BẠN CÓ TOOL THẬT: web_search · web_fetch · read_file · list_dir · bash · write_file · edit_file · consult_expert.
- Cần thông tin mới/thực tế (giá, tin, tài liệu) → PHẢI web_search rồi web_fetch trang cụ thể, KHÔNG bịa.
- Cần GÓC CHUYÊN SÂU ngoài thế mạnh → consult_expert(persona, question). Có 12 expert: finance, marketing, researcher, designer, data, architect, engineer, security, investigator, devops, tester, writer. Hỏi đúng người rồi DỆT ý họ vào câu trả lời (1 luồng, đừng chỉ chép).
- Đọc/sửa file: read_file/write_file/edit_file nhận PATH TUYỆT ĐỐI (ví dụ /root/lucy/hub/server/src/index.ts) hoặc tương đối từ workspace. Ưu tiên path tuyệt đối để tránh nhầm. KHÔNG đọc/echo secret (.env, .ssh, private key).
- Khi đã đủ → trả lời CUỐI bằng văn (KHÔNG kèm tool call). Xưng em, gọi chủ nhân.`

export type ToolTrace = { name: string; input: string; result: string }
export type LaneChatResult = { answer: string; trace: ToolTrace[]; usage: { inTok: number; outTok: number }; model: string; rateLimit?: { retryAfterMs: number } }

/** Vòng agentic chat cho lane model. messages = [system(persona+note), ...history, user]. onTool: stream tool-card. */
export async function chatLaneAgentic(
  modelKey: string, messages: RawMsg[], ws: string,
  opts: { maxTurns?: number; allowConsult?: boolean; onTool?: (e: { phase: 'use' | 'result'; name: string; input?: string; result?: string }) => void } = {},
): Promise<LaneChatResult> {
  const maxTurns = opts.maxTurns ?? 16
  // K2: phiên chính được consult_expert; sub-agent (allowConsult=false) thì KHÔNG (chặn đệ quy).
  const isMain = opts.allowConsult !== false
  // CL-2: flag ON → đọc ToolDef từ registry (1 nguồn); OFF → CHAT_TOOLS hard-code cũ. Hành vi tool giữ nguyên.
  const useRegistry = toolRegistryEnabled()
  if (useRegistry) ensureChatRegistered()
  const baseDefs = useRegistry ? getLaneToolDefs('lucy-lane') : CHAT_TOOLS
  const consultDef = useRegistry ? registry.toolDef('consult_expert')! : CONSULT_TOOL
  const tools = isMain ? [...baseDefs, consultDef] : baseDefs
  // nhắc tool cho agent chính (sub-agent đã có system riêng của expert)
  if (isMain && messages[0]?.role === 'system') messages = [{ role: 'system', content: (messages[0].content || '') + CHAT_LANE_NOTE }, ...messages.slice(1)]
  const trace: ToolTrace[] = []
  const usage = { inTok: 0, outTok: 0 }
  let lastModel = modelKey
  const seenTools = new Map<string, string>()  // chống model rẻ lặp gọi tool y hệt → cháy lượt
  for (let i = 0; i < maxTurns; i++) {
    let r
    try { r = await callLLMRaw(modelKey, messages, { tools, maxTokens: 4096, timeoutMs: 90000 }) }
    catch (e) {
      if (e instanceof RateLimitError) return { answer: `⏸️ model rẻ bị rate-limit (thử lại sau ~${Math.round(e.retryAfterMs / 1000)}s).`, trace, usage, model: lastModel, rateLimit: { retryAfterMs: e.retryAfterMs } }
      return { answer: '❌ lane lỗi: ' + String(e instanceof Error ? e.message : e).slice(0, 200), trace, usage, model: lastModel }
    }
    lastModel = r.modelKey
    usage.inTok += r.usage?.prompt_tokens ?? 0
    usage.outTok += r.usage?.completion_tokens ?? 0
    const msg = r.message
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls })
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* */ }
        const inputStr = JSON.stringify(args).slice(0, 600)
        opts.onTool?.({ phase: 'use', name: tc.function.name, input: inputStr })
        let out: string
        const sig = tc.function.name + ':' + inputStr
        if (seenTools.has(sig)) {
          // đã gọi y hệt rồi → không chạy lại, nhắc model dùng kết quả cũ & trả lời (tránh vòng lặp cháy lượt)
          out = '⚠️ Bạn đã gọi tool này với THAM SỐ Y HỆT ở trên rồi. Kết quả trước:\n' + seenTools.get(sig) + '\n→ ĐỪNG gọi lại; hãy TRẢ LỜI bằng thông tin đã có.'
        } else {
          // CL-2: dispatch qua registry khi flag ON (đã try/catch + sanitize bên trong); OFF → execChatTool cũ.
          try { out = useRegistry ? await dispatchTool(tc.function.name, args, { ws, mode: 'chat' }) : await execChatTool(tc.function.name, args, ws) }
          catch (e) { out = 'ERROR: ' + String(e instanceof Error ? e.message : e).slice(0, 200) }
          seenTools.set(sig, out.slice(0, 800))
        }
        trace.push({ name: tc.function.name, input: inputStr, result: out.slice(0, 800) })
        opts.onTool?.({ phase: 'result', name: tc.function.name, result: out.slice(0, 800) })
        messages.push({ role: 'tool', tool_call_id: tc.id, content: out.slice(0, 8000) })
      }
      continue
    }
    // không tool_call → câu trả lời cuối
    return { answer: (msg.content || '(rỗng)').trim(), trace, usage, model: lastModel }
  }
  // hết turn → ÉP model trả lời cuối bằng data đã thu (KHÔNG tool) thay vì bỏ cuộc
  try {
    const fin = await callLLMRaw(modelKey, [...messages, { role: 'user', content: 'Đã hết lượt dùng tool. Hãy TRẢ LỜI NGAY câu hỏi bằng thông tin đã thu thập ở trên — đừng gọi thêm tool, đừng nói "hết lượt".' }], { maxTokens: 4096, timeoutMs: 90000 })
    usage.inTok += fin.usage?.prompt_tokens ?? 0
    usage.outTok += fin.usage?.completion_tokens ?? 0
    const ans = (fin.message.content || '').trim()
    if (ans) return { answer: ans, trace, usage, model: fin.modelKey }
  } catch { /* fallthrough về nội dung cuối */ }
  const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content || ''
  return { answer: (last || '(chưa có kết luận — thử hỏi lại gọn hơn)').trim(), trace, usage, model: lastModel }
}
