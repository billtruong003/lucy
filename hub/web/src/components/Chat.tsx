import { useEffect, useRef, useState } from 'react'
import { chatStream, chatHistory, newChat, llmModels, listChats, switchChat, renameChat, deleteChat, type LlmModel, type ClaudeModel, type ChatConv } from '../api'
import Markdown from './Markdown'

type ToolCall = { id?: string; name: string; input: string; result?: string }
type Msg = {
  role: 'me' | 'lucy' | 'sys'
  text: string
  thinking?: string
  route?: string
  tools?: ToolCall[]
  model?: string      // nhãn model hiện ở badge
  status?: string     // trạng thái live khi đang stream
  done?: boolean      // đã stream xong chưa (tắt pulse)
  usage?: { inTok: number; cacheTok: number; outTok: number }   // E3: cache + context observability
}

const CTX_MAX = 1_000_000  // cửa sổ ctx Claude (1M) — cho badge ctx X%/tok
function fmtTok(n: number): string { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n) }

function modelLabel(key: string, models: LlmModel[], claude: ClaudeModel[]): string {
  if (key === 'auto') return 'Auto 🧭'
  const c = claude.find((m) => m.key === key)
  if (c) return c.label
  return models.find((m) => m.key === key)?.label || key
}

export default function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [inp, setInp] = useState('')
  const [model, setModel] = useState('claude:sonnet')
  const [models, setModels] = useState<LlmModel[]>([])
  const [claudeModels, setClaudeModels] = useState<ClaudeModel[]>([])
  const [busy, setBusy] = useState(false)
  const [queue, setQueue] = useState<string[]>([])
  const [listening, setListening] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})  // collapse state: "think-<i>" | "tool-<i>-<j>"
  const [convs, setConvs] = useState<ChatConv[]>([])   // Phase J: danh sách hội thoại
  const [curId, setCurId] = useState('')
  const [showBar, setShowBar] = useState(false)
  const [atBottom, setAtBottom] = useState(true)   // S2/E1.2: chỉ auto-scroll khi đang ở đáy
  const end = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const queueRef = useRef<string[]>([])
  const drainingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)   // D1: hủy stream đang chạy (Stop)
  const [pickerOpen, setPickerOpen] = useState(false)     // D1: popover model picker

  function refreshConvs() { listChats().then((d) => { setConvs(d.chats || []); setCurId(d.currentId || '') }).catch(() => {}) }
  async function openChat(id: string) {
    if (id === curId || drainingRef.current) return
    try { const d = await switchChat(id); setMsgs((d.messages || []).map((m) => ({ role: m.role, text: m.text, done: true }))); setCurId(id) } catch { /* */ }
    setShowBar(false); refreshConvs()
  }
  async function startNew() {
    if (drainingRef.current) return
    const r = await newChat(); setMsgs([]); if (r.id) setCurId(r.id); setShowBar(false); refreshConvs()
  }
  async function delConv(id: string) {
    if (!confirm('Xoá hội thoại này?')) return
    await deleteChat(id)
    if (id === curId) { const d = await chatHistory(); setMsgs((d.messages || []).map((m) => ({ role: m.role, text: m.text, done: true }))); setCurId(d.id || '') }
    refreshConvs()
  }
  async function renameConv(id: string, cur: string) {
    const t = prompt('Tên hội thoại:', cur); if (t && t.trim()) { await renameChat(id, t.trim()); refreshConvs() }
  }

  // S2/E1.2: auto-scroll chỉ khi user đang ở đáy (đọc lịch sử cũ thì không giật xuống)
  useEffect(() => { if (atBottom) end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, atBottom])
  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }
  function jumpToLatest() { setAtBottom(true); end.current?.scrollIntoView({ behavior: 'smooth' }) }
  // D6: đồng bộ lịch sử từ server (chat.json) — server LƯU câu trả lời kể cả khi client ngắt giữa chừng.
  // Chỉ sync khi KHÔNG đang stream (tránh đè UI live). Dùng khi mount + khi tab focus lại (out web rồi vào).
  function syncHistory() {
    if (drainingRef.current) return
    chatHistory().then((d) => { if (d.messages?.length) setMsgs(d.messages.map((m) => ({ role: m.role, text: m.text, done: true }))) }).catch(() => {})
  }
  useEffect(() => {
    syncHistory(); refreshConvs()
    llmModels().then((d) => { if (d.catalog?.length) setModels(d.catalog); if (d.claudeModels?.length) setClaudeModels(d.claudeModels) }).catch(() => {})
    // out web/đóng tab → vào lại: lấy các câu đã chạy xong server-side trong lúc vắng mặt (không mất status).
    const onVis = () => { if (document.visibilityState === 'visible') syncHistory() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis) }
  }, [])

  function startMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Trình duyệt không hỗ trợ nhập giọng nói — dùng Chrome.'); return }
    const rec = new SR(); rec.lang = 'vi-VN'; rec.interimResults = false
    setListening(true)
    rec.onresult = (e: any) => setInp((p) => (p ? p + ' ' : '') + e.results[0][0].transcript)
    rec.onend = () => setListening(false); rec.onerror = () => setListening(false)
    rec.start()
  }
  const toggle = (k: string) => setOpen((s) => ({ ...s, [k]: !s[k] }))
  // cập nhật message Lucy cuối (đang stream) theo patch
  function patchLucy(patch: (m: Msg) => Msg) {
    setMsgs((p) => { const c = [...p]; const i = c.length - 1; if (i >= 0) c[i] = patch(c[i]); return c })
  }
  // 1 lượt chat thật (stream). Tách riêng để queue gọi tuần tự.
  async function runOne(text: string) {
    setMsgs((p) => [...p, { role: 'me', text }, { role: 'lucy', text: '', model: modelLabel(model, models, claudeModels), status: 'đang nghĩ', tools: [] }])
    const ac = new AbortController(); abortRef.current = ac
    try {
      await chatStream(text, model, (e) => {
        if (e.type === 'route') patchLucy((m) => ({ ...m, route: e.text }))
        else if (e.type === 'thinking') patchLucy((m) => ({ ...m, thinking: (m.thinking || '') + (e.text || ''), status: 'đang suy nghĩ' }))
        else if (e.type === 'tool_use') patchLucy((m) => ({ ...m, status: 'dùng tool ' + (e.name || ''), tools: [...(m.tools || []), { id: e.id, name: e.name || 'tool', input: e.input || '' }] }))
        else if (e.type === 'tool_result') patchLucy((m) => ({ ...m, tools: (m.tools || []).map((t) => (t.id && t.id === e.id ? { ...t, result: e.text || '' } : t)) }))
        else if (e.type === 'usage') patchLucy((m) => ({ ...m, usage: { inTok: e.inTok || 0, cacheTok: e.cacheTok || 0, outTok: e.outTok || 0 } }))
        else if (e.type === 'delta') patchLucy((m) => ({ ...m, status: undefined, text: m.text + (e.text || '') }))
        else if (e.type === 'final') patchLucy((m) => ({ ...m, status: undefined, text: e.text || m.text }))
        else if (e.type === 'error') patchLucy((m) => ({ ...m, status: undefined, text: (m.text || '') + '\n❌ ' + (e.text || 'lỗi') }))
      }, ac.signal)
    } catch (e) {
      if (ac.signal.aborted) {
        // D1: user bấm Stop → giữ partial, đánh dấu đã dừng (server vẫn lưu xong bản đầy đủ).
        patchLucy((m) => ({ ...m, status: undefined, text: (m.text || '') + '\n\n⏹ _đã dừng_' }))
      } else {
        // D6: SSE đứt (đóng tab / mạng) KHÔNG phải lỗi thật — server vẫn chạy + lưu xong. Báo nhẹ rồi đồng bộ lại.
        patchLucy((m) => ({ ...m, status: undefined, text: m.text || '⏳ kết nối gián đoạn — em vẫn xử lý, đang đồng bộ lại…' }))
        setTimeout(syncHistory, 2500)
      }
    }
    abortRef.current = null
    patchLucy((m) => ({ ...m, status: undefined, done: true }))
  }
  // D1: Stop — hủy stream hiện tại + xoá hàng đợi còn lại
  function stopAll() {
    abortRef.current?.abort()
    queueRef.current = []; setQueue([])
  }
  // rút hàng đợi: chạy tuần tự cho tới khi queue rỗng (giống Hermes — nhắn nhiều tin 1 lần không mất)
  async function drain() {
    if (drainingRef.current) return
    drainingRef.current = true; setBusy(true)
    while (queueRef.current.length) {
      const text = queueRef.current.shift()!; setQueue([...queueRef.current])
      await runOne(text)
    }
    drainingRef.current = false; setBusy(false)
    refreshConvs()   // Phase J: cập nhật tiêu đề/thời gian hội thoại sau lượt chat
  }
  // gửi: đang bận thì XẾP HÀNG thay vì bỏ (mất tin)
  function go(override?: string) {
    const text = (override ?? inp).trim()
    if (!text) return
    setInp('')
    queueRef.current.push(text); setQueue([...queueRef.current])
    drain()
  }

  const laneModels = models.filter((m) => !['ds-v4-flash'].includes(m.key))
  const curClaude = claudeModels.find((m) => m.key === model)
  const curLabel = model === 'auto' ? '🧭 Auto (router tự chọn)'
    : curClaude ? `${curClaude.label}${curClaude.note ? ' — ' + curClaude.note : ''}`
    : (models.find((m) => m.key === model)?.label || model)

  return (
    <div className="h-full flex flex-col relative">
      {/* Phase J: thanh + drawer hội thoại đa-phiên */}
      <div className="flex items-center gap-2 px-3 sm:px-6 py-2 border-b border-line">
        <button onClick={() => { setShowBar((s) => !s); refreshConvs() }} className="btn btn-icon" title="Danh sách hội thoại">☰</button>
        <span className="text-xs text-inkdim truncate flex-1">{convs.find((c) => c.id === curId)?.title || 'Hội thoại'}</span>
        <button onClick={startNew} className="btn !py-1 !px-2.5 text-xs" title="Hội thoại mới">＋ mới</button>
      </div>
      {showBar && (
        <div className="absolute inset-0 z-30 flex" onClick={() => setShowBar(false)}>
          <div className="w-72 max-w-[82%] h-full overflow-auto p-2 border-r border-line" style={{ background: 'rgba(8,13,20,0.98)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-2 py-2">
              <span className="display text-[11px] tracking-[0.18em] text-cyan/80">HỘI THOẠI</span>
              <button onClick={startNew} className="btn !py-1 !px-2 text-xs">✨ mới</button>
            </div>
            {convs.length === 0 && <div className="text-inkfaint text-xs px-2 py-4">Chưa có hội thoại nào.</div>}
            {convs.map((c) => (
              <div key={c.id} className={'group rounded-lg px-2 py-1.5 mb-1 cursor-pointer flex items-center gap-1.5 ' + (c.id === curId ? 'bg-cyan/10 border border-cyan/25' : 'hover:bg-white/5')} onClick={() => openChat(c.id)}>
                <span className="flex-1 min-w-0">
                  <span className="text-[12px] text-inkdim truncate block">{c.title}</span>
                  <span className="text-[10px] text-inkfaint">{c.count} tin</span>
                </span>
                <button onClick={(e) => { e.stopPropagation(); renameConv(c.id, c.title) }} className="text-inkfaint hover:text-cyan text-[12px] sm:opacity-0 group-hover:opacity-100" title="Đổi tên">✎</button>
                <button onClick={(e) => { e.stopPropagation(); delConv(c.id) }} className="text-inkfaint hover:text-pink text-[12px] sm:opacity-0 group-hover:opacity-100" title="Xoá">🗑</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto px-3 sm:px-6 py-4 sm:py-5">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {msgs.length === 0 && (
            <div className="text-center text-inkfaint text-sm mt-16 sm:mt-20">
              <div className="text-3xl mb-3">🪐</div>
              Chào chủ nhân. Nhắn gì đó để bắt đầu —<br />research tiền, code, hay hỏi đáp đều được.
            </div>
          )}
          {msgs.map((m, i) => {
            if (m.role === 'sys') return <div key={i} className="self-center chip text-inkfaint">{m.text}</div>
            if (m.role === 'me') return (
              <div key={i} className="self-end max-w-[88%] sm:max-w-[82%] px-4 py-2.5 text-sm whitespace-pre-wrap break-words relative"
                style={{ background: 'rgba(56,208,255,0.08)', border: '1px solid rgba(56,208,255,0.32)',
                  clipPath: 'polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 9px 100%, 0 calc(100% - 9px))' }}>
                <span className="hud-lbl block mb-1 text-cyan/70" style={{ fontSize: '8.5px' }}>CHỦ NHÂN</span>{m.text}</div>
            )
            const streaming = !m.done
            return (
              <div key={i} className="self-start max-w-[92%] sm:max-w-[88%] flex gap-2.5">
                <img src="/lucy.jpg" alt="Lucy" className="mt-1 h-7 w-7 shrink-0 rounded-full object-cover"
                  style={{ border: '1px solid rgba(56,208,255,0.45)', animation: streaming ? 'lucy-pulse 1.6s infinite' : undefined }} />
                <div className="card px-4 py-3 min-w-0 w-full">
                  {/* Badge: tên + model */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="display text-[10px] tracking-[0.2em] text-cyan/80">LUCY</span>
                    {m.model && <span className="text-[10px] text-inkfaint px-1.5 py-0.5 rounded" style={{ background: 'rgba(56,208,255,0.08)' }}>{m.model}</span>}
                  </div>
                  {m.route && <div className="text-[11px] text-inkfaint mb-1.5">{m.route}</div>}

                  {/* Live status (khi đang stream) */}
                  {m.status && (
                    <div className="flex items-center gap-1.5 text-[11px] text-cyan/80 mb-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan" style={{ animation: 'lucy-pulse 1s infinite' }} />
                      {m.status === 'đang suy nghĩ' ? '💭 ' : m.status.startsWith('dùng tool') ? '🔧 ' : '✨ '}{m.status}…
                    </div>
                  )}

                  {/* 💭 Thinking (collapse) */}
                  {m.thinking && (
                    <div className="mb-2">
                      <button onClick={() => toggle('think-' + i)} className="text-[11px] text-amber-300/80 hover:text-amber-200">
                        💭 Suy nghĩ {open['think-' + i] ? '▾' : '▸'}
                      </button>
                      {open['think-' + i] && (
                        <div className="mt-1.5 text-[12px] text-inkdim whitespace-pre-wrap rounded-lg px-3 py-2 max-h-72 overflow-auto"
                          style={{ background: 'rgba(245,200,66,0.06)', border: '1px solid rgba(245,200,66,0.20)' }}>{m.thinking}</div>
                      )}
                    </div>
                  )}

                  {/* 🔧 Tool cards (mỗi tool 1 card, collapse) */}
                  {(m.tools && m.tools.length > 0) && (
                    <div className="flex flex-col gap-1.5 mb-2">
                      {m.tools.map((t, j) => {
                        const k = 'tool-' + i + '-' + j
                        return (
                          <div key={j} className="rounded-lg text-[12px]" style={{ background: 'rgba(95,227,154,0.06)', border: '1px solid rgba(95,227,154,0.22)' }}>
                            <button onClick={() => toggle(k)} className="w-full flex items-center gap-2 px-3 py-1.5 text-left">
                              <span className="text-grn">🔧</span>
                              <span className="text-grn/90 mono">{t.name}</span>
                              <span className="flex-1 text-inkfaint truncate">{t.result === undefined ? 'đang chạy…' : 'xong'}</span>
                              <span className="text-inkfaint">{open[k] ? '▾' : '▸'}</span>
                            </button>
                            {open[k] && (
                              <div className="px-3 pb-2 border-t border-line/50">
                                <div className="text-[10px] text-inkfaint mt-1.5 mb-0.5">tham số</div>
                                <pre className="text-[11px] text-inkdim whitespace-pre-wrap break-all max-h-32 overflow-auto">{t.input}</pre>
                                {t.result !== undefined && (
                                  <>
                                    <div className="text-[10px] text-inkfaint mt-1.5 mb-0.5">kết quả</div>
                                    <pre className="text-[11px] text-inkdim whitespace-pre-wrap break-all max-h-40 overflow-auto">{t.result}</pre>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* ✅ Câu trả lời */}
                  {m.text ? <Markdown>{m.text}</Markdown> : (!m.status && streaming && <span className="text-inkfaint text-sm">…</span>)}

                  {/* E3: badge cache + context — cho thấy não đang tiết kiệm + dùng tới đâu */}
                  {m.usage && m.usage.inTok > 0 && (
                    <div className="mt-2 pt-1.5 border-t border-line/40 flex flex-wrap gap-2 text-[10px] text-inkfaint">
                      <span title="tokens phục vụ từ cache (rẻ ~10%)">💾 cache {Math.round((m.usage.cacheTok / m.usage.inTok) * 100)}%</span>
                      <span title="context input đã dùng / cửa sổ 1M">🧠 ctx {fmtTok(m.usage.inTok)}/{fmtTok(CTX_MAX)} ({((m.usage.inTok / CTX_MAX) * 100).toFixed(1)}%)</span>
                      <span title="tokens sinh ra">✍️ out {fmtTok(m.usage.outTok)}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          <div ref={end} />
        </div>
      </div>

      <div className="px-3 sm:px-6 pb-4 sm:pb-5 relative">
        {/* S2/E1.2: nhảy tới tin mới nhất khi đã cuộn lên đọc lịch sử */}
        {!atBottom && msgs.length > 0 && (
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-10">
            <button onClick={jumpToLatest} className="btn glass !rounded-full !px-3.5 !py-2 text-xs shadow-lg" title="Xuống tin mới nhất">
              ↓ tin mới nhất
            </button>
          </div>
        )}
        {queue.length > 0 && (
          <div className="max-w-3xl mx-auto mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-inkfaint">
            <span className="text-amber-300/80">⏳ {queue.length} tin chờ:</span>
            {queue.map((q, i) => (
              <span key={i} className="chip max-w-[40%] truncate" title={q}>{q}</span>
            ))}
          </div>
        )}
        <div className="max-w-3xl mx-auto card p-2.5 sm:p-3">
          <textarea
            value={inp}
            onChange={(e) => setInp(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go() } }}
            placeholder="Nhắn Lucy…  (Enter gửi · Shift+Enter xuống dòng)"
            rows={2}
            className="input resize-none border-0 bg-transparent focus:shadow-none px-1 py-1"
          />
          <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-line">
            <button onClick={startMic} title="Nhập bằng giọng nói" className={'btn btn-icon ' + (listening ? 'text-pink border-pink/60' : '')} style={listening ? { animation: 'lucy-pulse 1s infinite' } : undefined}>🎤</button>
            {/* D1: model picker HUD popover thay <select> thô */}
            <div className="relative">
              <button onClick={() => setPickerOpen((v) => !v)} title={`Model: ${curLabel}`}
                className="btn !py-1.5 !px-3 text-xs inline-flex items-center gap-1.5 max-w-[52vw] sm:max-w-none">
                <span className="text-cyan">{model === 'auto' ? '🧭' : curClaude?.tier === 'fast' ? '⚡' : curClaude?.tier === 'deep' ? '🧠' : '✦'}</span>
                <span className="truncate">{curClaude?.label || (model === 'auto' ? 'Auto' : models.find((m) => m.key === model)?.label || model)}</span>
                <span className="text-inkfaint">▾</span>
              </button>
              {pickerOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} />
                  <div className="absolute bottom-full left-0 mb-2 z-40 w-72 max-w-[80vw] card !bg-surface4 p-1.5 max-h-[60vh] overflow-auto shadow-elev-lg">
                    <div className="hud-lbl px-2 py-1.5">Claude · có tool + vault</div>
                    {(claudeModels.length ? claudeModels : [{ key: 'claude:sonnet', label: 'Claude Sonnet', tier: 'balanced', note: 'nhanh' } as ClaudeModel]).map((m) => (
                      <button key={m.key} onClick={() => { setModel(m.key); setPickerOpen(false) }}
                        className={'w-full text-left px-2.5 py-2 rounded flex items-center gap-2 hover:bg-cyan/10 transition-colors ' + (model === m.key ? 'bg-cyan/10' : '')}>
                        <span className={model === m.key ? 'text-cyan' : 'text-inkfaint'}>{m.tier === 'fast' ? '⚡' : m.tier === 'deep' ? '🧠' : '✦'}</span>
                        <span className="flex-1 min-w-0"><span className={'block text-[13px] truncate ' + (model === m.key ? 'text-cyan' : 'text-ink')}>{m.label}</span>{m.note && <span className="block text-[10px] text-inkfaint truncate">{m.note}</span>}</span>
                      </button>
                    ))}
                    <button onClick={() => { setModel('auto'); setPickerOpen(false) }}
                      className={'w-full text-left px-2.5 py-2 mt-1 rounded flex items-center gap-2 hover:bg-cyan/10 ' + (model === 'auto' ? 'bg-cyan/10' : '')}>
                      <span className="text-cyan">🧭</span><span className="text-[13px] text-ink">Auto — router tự chọn</span>
                    </button>
                    {models.length > 0 && <div className="hud-lbl px-2 py-1.5 mt-1 border-t border-line">Lane · chat thuần</div>}
                    {laneModels.map((m) => (
                      <button key={m.key} onClick={() => { setModel(m.key); setPickerOpen(false) }}
                        className={'w-full text-left px-2.5 py-1.5 rounded text-[12px] hover:bg-cyan/10 ' + (model === m.key ? 'bg-cyan/10 text-cyan' : 'text-inkdim')}>
                        {m.label}{m.free ? ' · free' : ''}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button onClick={startNew} className="btn !py-1.5 !px-2.5 text-xs" title="Hội thoại mới">✨ mới</button>
            <div className="flex-1" />
            {busy
              ? <button onClick={stopAll} className="btn !border-rose/50 !text-rose hover:!bg-rose/10 px-5 inline-flex items-center gap-1.5" title="Dừng">■ Dừng</button>
              : <button onClick={() => go()} className="btn btn-primary px-5 sm:px-6">GỬI</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
