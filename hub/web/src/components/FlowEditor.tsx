// FlowEditor — định nghĩa / sửa QUY TRÌNH (pipeline) cho dự án. Mỗi bước = 1 persona,
// đánh dấu 🔒 gate (cần Bill duyệt). Lưu thành flow tự tạo, dùng được ngay khi tạo card.
import { useState } from 'react'
import { amUpsertPipeline, amRemovePipeline, type AmPipeline, type AmPersona } from '../api'

type Stage = { name: string; personaId: string; gate: boolean }
type Editing = { id?: string; name: string; stages: Stage[] }

export default function FlowEditor({ pipes, personas, onChanged }: { pipes: AmPipeline[]; personas: AmPersona[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const defP = personas[0]?.id || ''
  const pName = (id: string) => personas.find((p) => p.id === id)?.name || id

  const save = async () => { if (!editing || !editing.name.trim() || !editing.stages.length) return; await amUpsertPipeline({ id: editing.id, name: editing.name.trim(), stages: editing.stages }); setEditing(null); onChanged() }
  const del = async (id: string) => { if (confirm('Xoá flow này? (chỉ xoá được flow tự tạo, không còn card đang dùng)')) { await amRemovePipeline(id); onChanged() } }
  const upd = (i: number, patch: Partial<Stage>) => setEditing((e) => (e ? { ...e, stages: e.stages.map((s, k) => (k === i ? { ...s, ...patch } : s)) } : e))
  const addStage = () => setEditing((e) => (e ? { ...e, stages: [...e.stages, { name: `Bước ${e.stages.length + 1}`, personaId: defP, gate: false }] } : e))
  const rmStage = (i: number) => setEditing((e) => (e ? { ...e, stages: e.stages.filter((_, k) => k !== i) } : e))
  const move = (i: number, d: number) => setEditing((e) => { if (!e) return e; const a = [...e.stages]; const j = i + d; if (j < 0 || j >= a.length) return e;[a[i], a[j]] = [a[j], a[i]]; return { ...e, stages: a } })

  return (
    <div className="h-full overflow-auto p-4 sm:p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="display text-[14px] tracking-[0.14em] text-ink">QUY TRÌNH (FLOW)</div>
        {!editing && <button className="btn btn-primary ml-auto" onClick={() => setEditing({ name: '', stages: [{ name: 'Bước 1', personaId: defP, gate: false }] })}>+ Flow mới</button>}
      </div>

      {editing ? (
        <div className="card p-4 flex flex-col gap-3 max-w-2xl">
          <input className="input" placeholder="Tên quy trình (vd: Web feature, Game asset…)" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
          <div className="flex flex-col gap-2">
            {editing.stages.map((s, i) => (
              <div key={i} className="flex items-center gap-2 card !bg-black/20 p-2">
                <span className="text-[11px] text-inkfaint w-5 text-center shrink-0">{i + 1}</span>
                <input className="input !py-1.5 flex-1 text-[13px]" placeholder="tên bước" value={s.name} onChange={(e) => upd(i, { name: e.target.value })} />
                <select className="input !py-1.5 sm:!w-44 text-[12px]" value={s.personaId} onChange={(e) => upd(i, { personaId: e.target.value })}>
                  {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <label className="flex items-center gap-1 text-[11px] text-inkdim cursor-pointer shrink-0" title="cần Bill duyệt sau bước này"><input type="checkbox" checked={s.gate} onChange={(e) => upd(i, { gate: e.target.checked })} />🔒</label>
                <button className="btn btn-icon !w-6 !h-6 shrink-0" title="lên" onClick={() => move(i, -1)}>↑</button>
                <button className="btn btn-icon !w-6 !h-6 shrink-0" title="xuống" onClick={() => move(i, 1)}>↓</button>
                <button className="btn btn-icon !w-6 !h-6 shrink-0" title="bỏ bước" onClick={() => rmStage(i)}>✕</button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="btn !py-1.5" onClick={addStage}>+ bước</button>
            <button className="btn btn-primary !py-1.5 ml-auto" onClick={save} disabled={!editing.name.trim() || !editing.stages.length}>Lưu flow</button>
            <button className="btn !py-1.5" onClick={() => setEditing(null)}>Huỷ</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-w-2xl">
          {pipes.map((p) => (
            <div key={p.id} className="card p-3 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-ink">{p.name} <span className="text-[10px] text-inkfaint mono">{p.id}</span></div>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {p.stages.map((s, i) => (
                    <span key={i} className="text-[11px] text-inkdim flex items-center gap-1">
                      {i > 0 && <span className="text-inkfaint">→</span>}
                      <span className="chip !py-0 !px-1.5 !text-[10px]">{s.name}{s.gate ? ' 🔒' : ''}</span>
                      <span className="text-[9px] text-inkfaint">{pName(s.personaId).replace(/·.*/, '').trim()}</span>
                    </span>
                  ))}
                </div>
              </div>
              <button className="btn !py-1 !text-[11px] shrink-0" onClick={() => setEditing({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ name: s.name, personaId: s.personaId, gate: !!s.gate })) })}>Sửa</button>
              <button className="btn btn-icon !w-7 !h-7 shrink-0" title="xoá flow" onClick={() => del(p.id)}>🗑</button>
            </div>
          ))}
          {pipes.length === 0 && <div className="text-inkfaint text-sm p-6 text-center card">Chưa có flow.</div>}
        </div>
      )}
    </div>
  )
}
