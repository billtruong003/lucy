// LucyChat — Lucy hội thoại per-project: trò chuyện DÀI để gom ý tưởng, hỏi lại khi
// chưa rõ, và khi đủ rõ thì đề xuất các task (card) có nút Tạo. Dùng bridge claude (send/poll).
import { useEffect, useRef, useState } from 'react'
import { send, poll, amCreateCard, amState, amLogLucy, type AmPipeline, type AmCard, type AmMsg } from '../api'
import { parseDrafts, type Draft } from './Planner'
import Markdown from './Markdown'

type Msg = { role: 'me' | 'lucy'; text: string; drafts?: Draft[]; created?: boolean }

function convPrompt(project: string, pipes: AmPipeline[], transcript: string, context: string): string {
  const plist = pipes.map((p) => `- ${p.id}: ${p.name} (${p.stages.map((s) => s.name).join(' → ')})`).join('\n')
  return [
    `Bạn là Lucy — điều phối viên kỹ thuật của dự án "${project}". Trò chuyện với chủ để GOM yêu cầu/ý tưởng rồi chia thành task.`,
    `Pipeline có sẵn (chỉ chọn id trong đây):`, plist || '- (không có)',
    context, // E3: trạng thái task + agent đang nói gì -> Lucy align, không mù
    ``,
    `QUY TẮC:`,
    `- Nếu yêu cầu CHƯA đủ rõ để chia task -> HỎI LẠI ngắn gọn (1-2 câu), KHÔNG kèm json.`,
    `- Khi ĐÃ đủ rõ -> trả lời 1 câu chốt NGẮN rồi kèm DUY NHẤT 1 khối json ở cuối:`,
    '```json', `[{"title":"...","brief":"...","pipelineId":"<id>","model":"sonnet|opus","dependsOn":<index task phải xong TRƯỚC, bỏ trống nếu chạy ngay>}]`, '```',
    `- THỨ TỰ QUAN TRỌNG: nếu task B cần task A xong trước (vd setup trước khi build, build trước khi test) -> đặt "dependsOn" = index (0-based) của task A. Task độc lập thì bỏ dependsOn. Đừng để mọi task chạy song song khi chúng phụ thuộc nhau.`,
    `- CHIA ĐỦ task như product owner: mục tiêu lớn -> nhiều task nhỏ (5-15), mỗi task 1 việc rõ, model opus cho việc khó.`,
    `- Trả lời tiếng Việt, gọn, xưng "em" gọi "chủ". Dùng TRẠNG THÁI DỰ ÁN ở trên để biết đã làm gì, đang vướng gì.`,
    ``,
    `HỘI THOẠI:`, transcript, `Lucy:`,
  ].join('\n')
}

function buildContext(project: string, cards: AmCard[], channels: AmMsg[]): string {
  const pc = cards.filter((c) => (c.projectId || 'default') === project)
  if (!pc.length) return ''
  const cardLines = pc.slice(0, 30).map((c) => `- [${c.status}] ${c.title}${c.lastSummary ? ' — ' + c.lastSummary.slice(0, 100) : ''}`).join('\n')
  const ids = new Set(pc.map((c) => 'card-' + c.id))
  const recent = channels.filter((m) => ids.has(m.channel) && m.author !== 'bill' && m.kind !== 'system').slice(-12).map((m) => `${m.author}: ${m.text.slice(0, 120)}`).join('\n')
  return `\n\nTRẠNG THÁI DỰ ÁN (để align — KHÔNG đề xuất lại task đã có):\nTask hiện có:\n${cardLines}\n\nAgent gần đây nói:\n${recent || '(chưa có)'}`
}

export default function LucyChat({ project, pipes, onCreated }: { project: string; pipes: AmPipeline[]; onCreated: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'lucy', text: 'Chào chủ 👋 Dự án này chủ muốn làm gì? Cứ kể tự nhiên — em hỏi lại cho rõ rồi chia task.' }])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [secs, setSecs] = useState(0)
  const [opus, setOpus] = useState(false)        // W1.3: 2 chế độ — Bill bật opus khi muốn
  const [listening, setListening] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [msgs, busy])

  // W1.4: nhập giọng nói (STT trình duyệt) — như chat tổng
  function startMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Trình duyệt không hỗ trợ nhập giọng nói — dùng Chrome.'); return }
    const rec = new SR(); rec.lang = 'vi-VN'; rec.interimResults = false
    setListening(true)
    rec.onresult = (e: any) => setDraft((p) => (p ? p + ' ' : '') + e.results[0][0].transcript)
    rec.onend = () => setListening(false); rec.onerror = () => setListening(false)
    rec.start()
  }

  // V3: nạp lại lịch sử chat đã lưu (kênh __lucy) khi mở dự án — qua F5/đa thiết bị
  useEffect(() => {
    let alive = true
    amState().then((s) => {
      if (!alive) return
      const hist = (s.channels || []).filter((m) => m.channel === `p:${project}:__lucy`).map((m) => ({ role: m.author === 'bill' ? 'me' : 'lucy', text: m.text } as Msg))
      if (hist.length) setMsgs(hist)
    }).catch(() => { /* */ })
    return () => { alive = false }
  }, [project])

  const sendMsg = async () => {
    if (!draft.trim() || busy) return
    const userText = draft.trim()
    const hist: Msg[] = [...msgs, { role: 'me', text: userText }]
    setMsgs(hist); setDraft(''); setBusy(true); setSecs(0)
    amLogLucy(project, 'me', userText).catch(() => { /* */ })
    const t = setInterval(() => setSecs((s) => s + 1), 1000)
    try {
      const transcript = hist.map((m) => `${m.role === 'me' ? 'Chủ' : 'Lucy'}: ${m.text}`).join('\n')
      let context = ''
      try { const st = await amState(); context = buildContext(project, st.cards || [], st.channels || []) } catch { /* */ } // E3: Lucy đọc trạng thái + channel
      const { job_id } = await send(convPrompt(project, pipes, transcript, context), opus, `proj:${project}`)
      let res = ''
      for (let i = 0; i < 100; i++) { await new Promise((s) => setTimeout(s, 1200)); const p = await poll(job_id); if (p.result != null) { res = p.result; break }; if (p.status === 'error' || p.status === 'failed') throw new Error('bridge') }
      const ds = parseDrafts(res, pipes)
      const text = res.replace(/```json[\s\S]*?```/g, '').trim() || (ds.length ? 'Em đề xuất các task dưới đây:' : '(không có nội dung)')
      setMsgs((h) => [...h, { role: 'lucy', text, drafts: ds.length ? ds : undefined }])
      amLogLucy(project, 'lucy', text).catch(() => { /* */ })
    } catch { setMsgs((h) => [...h, { role: 'lucy', text: '⚠️ Lỗi gọi Lucy — thử lại.' }]) } finally { clearInterval(t); setBusy(false) }
  }

  const createDrafts = async (idx: number, ds: Draft[]) => {
    // tạo theo THỨ TỰ; dependsOn (index task trước) -> blockedBy = id task đó (E1)
    const ids: string[] = []
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i]
      const dep = typeof d.dependsOn === 'number' && d.dependsOn >= 0 && d.dependsOn < i && ids[d.dependsOn] ? [ids[d.dependsOn]] : undefined
      const res = await amCreateCard(d.title, d.brief, d.pipelineId, project, false, d.model, dep)
      ids[i] = res?.card?.id || ''
    }
    onCreated()
    setMsgs((h) => h.map((m, k) => (k === idx ? { ...m, created: true } : m)))
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {msgs.map((m, i) => (
          m.role === 'me' ? (
            <div key={i} className="self-end max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-[13px] leading-snug whitespace-pre-wrap break-words bg-cyan/15 text-ink">{m.text}</div>
          ) : (
            <div key={i} className="self-start max-w-[92%] flex gap-2.5">
              <img src="/lucy.jpg" alt="Lucy" className="mt-1 h-7 w-7 shrink-0 rounded-full object-cover" style={{ border: '1px solid rgba(56,208,255,0.45)' }} />
              <div className="min-w-0 flex-1">
                <div className="card px-3.5 py-2.5 min-w-0">
                  <div className="display text-[10px] tracking-[0.2em] text-cyan/80 mb-1">LUCY</div>
                  <Markdown>{m.text}</Markdown>
                </div>
                {m.drafts && (
                  <div className="mt-2 card !bg-black/20 p-2.5 flex flex-col gap-1.5">
                    <div className="text-[11px] text-inkfaint">{m.drafts.length} task đề xuất:</div>
                    {m.drafts.map((d, k) => (
                      <div key={k} className="flex items-center gap-2 text-[12px]">
                        <span className="text-inkdim truncate flex-1">{d.title}</span>
                        <span className="chip !py-0 !px-1.5 !text-[9px]">{pipes.find((p) => p.id === d.pipelineId)?.name || d.pipelineId}</span>
                        <span className="chip !py-0 !px-1.5 !text-[9px]" style={{ color: d.model === 'opus' ? '#b78cff' : '#7fe3ff' }}>{d.model}</span>
                      </div>
                    ))}
                    <button className="btn btn-primary !py-1.5 mt-1 self-start" disabled={m.created} onClick={() => createDrafts(i, m.drafts!)}>
                      {m.created ? '✓ Đã tạo' : `✓ Tạo ${m.drafts.length} task`}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        ))}
        {busy && <div className="self-start text-[12px] text-cyan flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-cyan animate-pulse" />Lucy đang nghĩ… {secs}s</div>}
        <div ref={endRef} />
      </div>
      <div className="shrink-0 border-t border-line p-2.5 flex flex-col gap-2">
        <div className="flex gap-2">
          <textarea className="input flex-1 resize-none" rows={2} placeholder="Kể cho Lucy nghe ý tưởng / yêu cầu… (Enter gửi · Shift+Enter xuống dòng)" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg() } }} disabled={busy} />
          <button className="btn btn-primary shrink-0 self-stretch" onClick={sendMsg} disabled={busy || !draft.trim()}>Gửi</button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={startMic} title="Nhập bằng giọng nói" className={'btn btn-icon !w-8 !h-8 ' + (listening ? 'text-pink border-pink/60' : '')} style={listening ? { animation: 'lucy-pulse 1s infinite' } : undefined}>🎤</button>
          <button onClick={() => setOpus(!opus)} className="flex items-center gap-1.5 text-xs text-inkdim" title="Dùng Opus (sâu hơn, chậm hơn)">
            <span className="switch" data-on={opus} /> opus
          </button>
        </div>
      </div>
    </div>
  )
}
