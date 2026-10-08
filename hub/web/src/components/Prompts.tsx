import { useEffect, useMemo, useRef, useState } from 'react'
import {
  promptArchHistory, promptArchRun, promptArchEscalate,
  type PromptSession, type PromptArchHistMsg, type PromptScorecard,
} from '../api'
import { CompareView, Scorecard, VariantTabs } from './PromptCompare'
import { copyText } from './copyText'

const TURNS_KEY = 'pa_turns_v1'

// CỤM B / task 4 — tab "Prompt Architect": dán ngữ cảnh thô → câu hỏi làm-rõ (nếu mơ hồ) HOẶC prompt
// chia sections + nút COPY; panel lịch sử (store.recent); nút "Escalate bằng Claude".
// Flag LUCY_PROMPT_ARCHITECT TẮT → tab này không render (App kiểm tra status trước).

type Turn = {
  role: 'user' | 'lucy'; text: string; clarifying?: boolean; finalPrompt?: string; sessionId?: number | null; escalated?: boolean
  // PA-D: meta render — điểm rubric · đa biến thể · đã áp phong cách · prompt cũ (so sánh khi escalate).
  scorecard?: PromptScorecard; variants?: string[]; preferenceApplied?: boolean; prevPrompt?: string
}

function CopyBtn({ text, label = '📋 Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  if (!text.trim()) return null
  return (
    <button
      className="btn !py-1 !px-2.5 !text-[11px] shrink-0"
      onClick={() => { const ok = copyText(text); setDone(true); setTimeout(() => setDone(false), 1400); if (!ok) alert('Copy lỗi — bôi đen chọn tay nhé') }}
    >{done ? '✓ đã copy' : label}</button>
  )
}

// PA-D: nút bật/tắt so sánh side-by-side prompt cũ (architect rẻ) ↔ mới (Claude escalate).
function CompareToggle({ prev, next }: { prev: string; next: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="mt-2">
      <button onClick={() => setShow((s) => !s)} className="btn !py-0.5 !px-2 !text-[10px] border-gold/40 text-gold">
        {show ? '✕ ẩn so sánh' : '⇄ so sánh với bản architect'}
      </button>
      {show && <CompareView left={prev} right={next} leftLabel="Architect (rẻ)" rightLabel="Claude (escalate)" />}
    </div>
  )
}

export default function Prompts() {
  const [turns, setTurns] = useState<Turn[]>(() => {
    try { return JSON.parse(localStorage.getItem(TURNS_KEY) || '[]') } catch { return [] }
  })
  const [context, setContext] = useState('')
  const [targetModel, setTargetModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [escalating, setEscalating] = useState(false)
  const [multiVariant, setMultiVariant] = useState(false) // PA-D: bật → xin 2 biến thể để so sánh
  const [history, setHistory] = useState<PromptSession[]>([])
  const [openSess, setOpenSess] = useState<number | null>(null)
  const [diffSess, setDiffSess] = useState<number | null>(null) // PA-D: phiên đang xem diff bản gốc↔bản sửa
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadHistory = () => promptArchHistory(20).then((d) => setHistory(d.sessions || [])).catch(() => { })
  useEffect(() => { loadHistory() }, [])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [turns])
  // Lưu hội thoại để refresh KHÔNG mất (giữ 40 lượt gần nhất).
  useEffect(() => { try { localStorage.setItem(TURNS_KEY, JSON.stringify(turns.slice(-40))) } catch { /* quota */ } }, [turns])

  // lịch sử gửi core: CHỈ 6 lượt gần nhất (đủ cho vòng làm-rõ) → KHÔNG nhồi cả conversation = đỡ đốt token.
  const histForCore = (): PromptArchHistMsg[] =>
    turns.slice(-6).map((t) => ({ role: t.role === 'user' ? ('user' as const) : ('assistant' as const), content: t.text }))

  // Reset session: xoá hội thoại hiện tại + localStorage → bắt đầu prompt mới, không kéo theo ngữ cảnh cũ.
  const resetSession = () => {
    if (busy || escalating) return
    setTurns([]); setContext(''); try { localStorage.removeItem(TURNS_KEY) } catch { /* noop */ }
  }

  const send = async () => {
    const c = context.trim()
    if (!c || busy) return
    const hist = histForCore()
    setTurns((p) => [...p, { role: 'user', text: c }, { role: 'lucy', text: '', clarifying: false }])
    setContext('')
    setBusy(true)
    const idx = turns.length + 1 // index của bong bóng 'lucy' vừa thêm
    try {
      await promptArchRun(c, hist, targetModel.trim() || undefined, (e) => {
        if (e.type === 'delta' && e.text) {
          setTurns((p) => { const n = [...p]; if (n[idx]) n[idx] = { ...n[idx], text: (n[idx].text || '') + e.text }; return n })
        } else if (e.type === 'route' && e.text) {
          setTurns((p) => { const n = [...p]; if (n[idx]) n[idx] = { ...n[idx], text: e.text + '\n\n' + (n[idx].text || '') }; return n })
        } else if (e.type === 'final') {
          setTurns((p) => { const n = [...p]; if (n[idx]) n[idx] = { ...n[idx], text: e.text || n[idx].text, clarifying: !!e.clarifying, finalPrompt: e.finalPrompt || '', sessionId: e.sessionId ?? null, escalated: !!e.escalated, scorecard: e.scorecard, variants: e.variants, preferenceApplied: e.preferenceApplied }; return n })
        } else if (e.type === 'error' && e.text) {
          setTurns((p) => { const n = [...p]; if (n[idx]) n[idx] = { ...n[idx], text: '❌ ' + e.text }; return n })
        }
      }, multiVariant ? 2 : undefined)
    } finally { setBusy(false); loadHistory() }
  }

  // Escalate: gửi NGỮ CẢNH GỐC gần nhất (lượt user trước câu trả lời cuối) lên Claude.
  const escalate = async () => {
    if (escalating || busy) return
    const lastUser = [...turns].reverse().find((t) => t.role === 'user')
    if (!lastUser) { return }
    const lastLucy = [...turns].reverse().find((t) => t.role === 'lucy')
    const prevPrompt = lastLucy?.finalPrompt || '' // PA-D: prompt architect rẻ → so sánh với bản Claude dựng lại
    const hist = histForCore().slice(0, -2) // bỏ cặp cuối (chính là input đang escalate)
    setEscalating(true)
    setTurns((p) => [...p, { role: 'lucy', text: '⬆️ Đang nhờ Claude dựng lại (chất hơn)…', escalated: true }])
    const idx = turns.length
    try {
      const r = await promptArchEscalate(lastUser.text, hist, targetModel.trim() || undefined, lastLucy?.sessionId ?? null)
      setTurns((p) => { const n = [...p]; if (n[idx]) n[idx] = { role: 'lucy', text: r.error ? '❌ ' + r.error : r.answer, clarifying: r.clarifying, finalPrompt: r.finalPrompt, sessionId: r.sessionId, escalated: true, scorecard: r.scorecard, prevPrompt: prevPrompt && r.finalPrompt ? prevPrompt : undefined }; return n })
    } finally { setEscalating(false); loadHistory() }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
  }

  const hasReply = useMemo(() => turns.some((t) => t.role === 'lucy' && t.text.trim()), [turns])

  return (
    <div className="h-full flex min-h-0">
      {/* CỘT CHÍNH — hội thoại + composer */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5">
          <div className="max-w-3xl mx-auto flex flex-col gap-4">
            {turns.length === 0 && (
              <div className="card p-5 text-center">
                <div className="display text-sm tracking-[0.18em] text-cyan mb-2">PROMPT ARCHITECT</div>
                <div className="text-[13px] text-inkdim leading-relaxed">
                  Dán ngữ cảnh thô của bạn → Lucy dựng lại thành <b className="text-ink">prompt chia sections</b>
                  {' '}(Role · Context · Task · Constraints · Output · Self-check). Mơ hồ cao thì hỏi làm-rõ trước.
                </div>
                <div className="text-[11px] text-inkfaint mt-2">Model rẻ cho cấu trúc · nút ⬆️ Escalate dùng Claude khi cần chất hơn.</div>
              </div>
            )}

            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'self-end max-w-[85%]' : 'self-start w-full'}>
                {t.role === 'user' ? (
                  <div className="glass glass-hi px-4 py-2.5 rounded-2xl text-[13px] text-ink whitespace-pre-wrap leading-relaxed">{t.text}</div>
                ) : (
                  <div className={'glass p-4 rounded-2xl ' + (t.escalated ? 'border-gold/40' : '')}>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="num text-[10px] text-cyan">{t.escalated ? '⬆️ Claude' : '🛠️ Architect'}</span>
                      {t.clarifying && <span className="chip num !text-[9px] text-gold border-gold/40">câu hỏi làm-rõ</span>}
                      {t.finalPrompt && <span className="chip num !text-[9px] text-grn border-grn/40">prompt sẵn</span>}
                      {t.preferenceApplied && <span className="chip num !text-[9px] text-cyan border-cyan/40" title="Đã chèn phong cách học từ lịch sử">🎯 phong cách</span>}
                      {t.variants && t.variants.length > 1 && <span className="chip num !text-[9px] text-cyan border-cyan/40">{t.variants.length} biến thể</span>}
                      <span className="flex-1" />
                      {t.finalPrompt
                        ? <CopyBtn text={t.finalPrompt} label="📋 Copy prompt" />
                        : (t.text.trim() && <CopyBtn text={t.text} />)}
                    </div>
                    {t.text.trim()
                      ? <pre className="whitespace-pre-wrap break-words font-sans text-[13px] text-ink leading-relaxed m-0">{t.text}</pre>
                      : <div className="text-inkfaint text-[12px]">Đang dựng…</div>}
                    {/* PA-D: điểm rubric · đa biến thể (so sánh A↔B) · so sánh prompt cũ↔Claude khi escalate */}
                    {t.scorecard && <Scorecard card={t.scorecard} />}
                    {t.variants && t.variants.length > 1 && <VariantTabs variants={t.variants} />}
                    {t.prevPrompt && t.finalPrompt && <CompareToggle prev={t.prevPrompt} next={t.finalPrompt} />}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* COMPOSER */}
        <div className="shrink-0 border-t border-line bg-panel/30 px-4 sm:px-6 py-3">
          <div className="max-w-3xl mx-auto flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <select
                value={targetModel} onChange={(e) => setTargetModel(e.target.value)}
                title="Prompt này sẽ chạy trên model nào → tối ưu style cho đúng họ model"
                className="input !py-1.5 text-[12px] flex-1 max-w-xs"
              >
                <option value="">🎯 Target model: tự động</option>
                <option value="claude">Claude (Anthropic)</option>
                <option value="gpt">GPT (OpenAI)</option>
                <option value="gemini">Gemini (Google)</option>
                <option value="deepseek">DeepSeek / model nhỏ</option>
              </select>
              <button
                onClick={() => setMultiVariant((v) => !v)}
                title="Dựng 2 biến thể để so sánh A↔B"
                className={'btn !py-1.5 !text-[12px] ' + (multiVariant ? 'border-cyan/50 text-cyan' : 'text-inkdim')}
              >⇄ {multiVariant ? '2 biến thể' : '1 bản'}</button>
              {turns.length > 0 && (
                <button onClick={resetSession} disabled={busy || escalating}
                  title="Xoá hội thoại → prompt mới, không kéo ngữ cảnh cũ (đỡ tốn token)"
                  className="btn !py-1.5 !text-[12px] text-inkdim disabled:opacity-40">🆕 Mới</button>
              )}
              {hasReply && (
                <button className="btn !py-1.5 !text-[12px] border-gold/40 text-gold disabled:opacity-40" onClick={escalate} disabled={escalating || busy}>
                  {escalating ? '⬆️ Claude…' : '⬆️ Escalate bằng Claude'}
                </button>
              )}
            </div>
            <div className="flex gap-2 items-end">
              <textarea
                value={context} onChange={(e) => setContext(e.target.value)} onKeyDown={onKey}
                placeholder="Dán ngữ cảnh thô cần biến thành prompt… (⌘/Ctrl+Enter để gửi)"
                rows={3}
                className="input flex-1 resize-y min-h-[64px] text-[13px]"
              />
              <button className="btn btn-primary shrink-0 self-stretch !px-5" onClick={send} disabled={busy || !context.trim()}>
                {busy ? '…' : 'Dựng'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CỘT LỊCH SỬ (store.recent) — ẩn trên mobile */}
      <aside className="hidden lg:flex w-72 shrink-0 flex-col border-l border-line bg-panel/20 min-h-0">
        <div className="px-4 pt-4 pb-2 flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-inkfaint uppercase tracking-widest flex-1">Lịch sử</span>
          <button onClick={loadHistory} className="btn btn-icon !w-7 !h-7 !text-[12px]" title="Tải lại">↻</button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4 flex flex-col gap-2">
          {history.length === 0 && <div className="text-inkfaint text-[12px] px-1 py-3">Chưa có phiên nào.</div>}
          {history.map((s) => {
            const open = openSess === s.id
            const title = (s.contextInput || '(rỗng)').replace(/\s+/g, ' ').trim()
            return (
              <div key={s.id} className={'glass glass-hover p-2.5 rounded-xl cursor-pointer ' + (s.escalated ? 'border-gold/30' : '')}
                onClick={() => setOpenSess(open ? null : s.id)}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="num text-[9px] text-inkfaint">{new Date(s.ts).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  {s.escalated ? <span className="chip num !text-[8px] text-gold border-gold/40">Claude</span> : <span className="num text-[8px] text-inkfaint">{s.laneModel}</span>}
                  {s.clarifyAsked && !s.finalPrompt && <span className="chip num !text-[8px] text-gold border-gold/30">hỏi</span>}
                </div>
                <div className="text-[12px] text-inkdim leading-snug line-clamp-2">{title}</div>
                {open && (
                  <div className="mt-2 pt-2 border-t border-line flex flex-col gap-2">
                    {s.finalPrompt ? (
                      <div>
                        <div className="flex items-center gap-1 mb-1">
                          <span className="num text-[9px] text-grn flex-1">PROMPT</span>
                          <CopyBtn text={s.finalPrompt} label="📋" />
                        </div>
                        <pre className="num text-[10px] text-inkdim whitespace-pre-wrap leading-snug max-h-48 overflow-y-auto bg-white/[0.02] rounded p-1.5">{s.finalPrompt}</pre>
                      </div>
                    ) : s.clarifyAsked ? (
                      <div className="text-[11px] text-inkdim whitespace-pre-wrap leading-snug">{s.clarifyAsked}</div>
                    ) : null}
                    {s.userEdit && (
                      <div onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1 mb-1">
                          <span className="num text-[9px] text-cyan flex-1">BẢN SỬA</span>
                          {s.finalPrompt && s.finalPrompt.trim() !== s.userEdit.trim() && (
                            <button onClick={() => setDiffSess(diffSess === s.id ? null : s.id)}
                              className="btn !py-0 !px-1.5 !text-[9px] border-gold/40 text-gold">
                              {diffSess === s.id ? '✕ diff' : '⇄ diff'}
                            </button>
                          )}
                        </div>
                        {diffSess === s.id && s.finalPrompt
                          ? <CompareView left={s.finalPrompt} right={s.userEdit} leftLabel="Bản gốc" rightLabel="Bản sửa" />
                          : <pre className="num text-[10px] text-inkdim whitespace-pre-wrap leading-snug max-h-32 overflow-y-auto">{s.userEdit}</pre>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </aside>
    </div>
  )
}
