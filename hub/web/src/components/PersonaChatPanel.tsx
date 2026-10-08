import { useEffect, useRef, useState } from 'react'
import { amPersonaChat, type AmPersona, type PersonaChatMsg } from '../api'
import Markdown from './Markdown'

// M3.5 — panel chat đa lượt với 1 persona (mang đầy đủ danh tính + history riêng).
export default function PersonaChatPanel({ persona, onClose }: { persona: AmPersona; onClose: () => void }) {
  const [msgs, setMsgs] = useState<PersonaChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    const next = [...msgs, { role: 'user' as const, content: text }]
    setMsgs(next); setInput(''); setBusy(true)
    const r = await amPersonaChat(persona.id, text, msgs)
    setBusy(false)
    if (r.off) { setOff(true); return }
    const answer = r.answer || ('⚠️ ' + (r.error || 'không có phản hồi'))
    setMsgs([...next, { role: 'assistant', content: answer }])
  }

  const initial = (persona.name || '?').replace(/·.*/, '').trim().slice(0, 2).toUpperCase()
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <div className="glass h-full w-full max-w-md flex flex-col border-l border-cyan/20" onClick={(e) => e.stopPropagation()}>
        {/* header — danh tính persona */}
        <div className="flex items-center gap-3 p-4 border-b border-white/5">
          <div className="relative w-10 h-10 shrink-0">
            <div className="arc-reactor absolute inset-0" />
            <div className="absolute inset-0 flex items-center justify-center num text-[12px] text-cyan font-bold">{initial}</div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-ink truncate">{persona.name}</div>
            <div className="text-[11px] text-inkfaint truncate">
              {persona.laneModel ? <span className="num">⚡{persona.laneModel}</span> : <span className="num uppercase">{persona.model}</span>}
              {persona.realm && persona.realm !== '—' && <span> · {persona.realm}</span>}
            </div>
          </div>
          <button onClick={onClose} className="btn !py-1 !px-2 text-sm">✕</button>
        </div>

        {/* messages */}
        <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">
          {msgs.length === 0 && !off && (
            <div className="text-center text-inkfaint text-[12px] mt-8">
              <div className="text-2xl mb-2">💬</div>
              Trò chuyện trực tiếp với <span className="text-cyan">{persona.name}</span>.<br />Chuyên gia nhớ mạch hội thoại.
            </div>
          )}
          {off && (
            <div className="card p-4 text-center text-rose/90 text-[12px]">
              Chat persona đang TẮT trên coordinator.<br />Bật cờ <span className="num">LUCY_PERSONA_CHAT=1</span> để dùng.
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'self-end max-w-[85%]' : 'self-start max-w-[92%]'}>
              <div className={'rounded-xl px-3 py-2 text-[13px] ' + (m.role === 'user' ? 'bg-cyan/12 border border-cyan/20 text-ink' : 'glass text-inkdim')}>
                {m.role === 'user' ? m.content : <Markdown>{m.content}</Markdown>}
              </div>
            </div>
          ))}
          {busy && <div className="self-start text-[12px] text-inkfaint animate-pulse">{persona.name.replace(/·.*/, '').trim()} đang nghĩ…</div>}
          <div ref={endRef} />
        </div>

        {/* composer */}
        <div className="p-3 border-t border-white/5 flex gap-2">
          <textarea className="input resize-none flex-1 !py-2" rows={1} placeholder={'Nhắn ' + persona.name.replace(/·.*/, '').trim() + '…'}
            value={input} disabled={off}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
          <button onClick={send} disabled={busy || off || !input.trim()} className="btn btn-primary">{busy ? '…' : 'Gửi'}</button>
        </div>
      </div>
    </div>
  )
}
