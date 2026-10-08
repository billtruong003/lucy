// Planner — Lucy orchestrator (meta-author). Bạn tả mục tiêu → Lucy (qua bridge claude)
// soạn danh sách CARD + chọn pipeline/model → bạn duyệt/sửa → tạo hàng loạt vào dự án.
import { useState } from 'react'
import { send, poll, amCreateCard, type AmPipeline } from '../api'

export type Draft = { title: string; brief: string; pipelineId: string; model: 'sonnet' | 'opus'; defer: boolean; dependsOn?: number }

export function buildDraftPrompt(goal: string, project: string, pipes: AmPipeline[]): string {
  const plist = pipes.map((p) => `- ${p.id}: ${p.name} (${p.stages.map((s) => s.name).join(' → ')})`).join('\n')
  return [
    `Bạn là Lucy — điều phối viên kỹ thuật. Người dùng muốn làm (dự án "${project}"):`,
    `"""\n${goal}\n"""`,
    ``,
    `Pipeline CÓ SẴN (chỉ được chọn id trong đây):`,
    plist || '- (không có)',
    ``,
    `Hãy CHIA mục tiêu thành các CARD công việc cụ thể, mỗi card:`,
    `- chọn 1 pipelineId phù hợp nhất, viết "brief" rõ ràng đủ để agent tự làm.`,
    `- chọn "model": "opus" cho việc khó/kiến trúc/review sâu, "sonnet" cho việc thường.`,
    `Chia hợp lý (đừng quá nhỏ vụn, đừng gộp 1 card khổng lồ).`,
    ``,
    `CHỈ trả về DUY NHẤT một khối JSON (KHÔNG thêm chữ nào trước/sau khối):`,
    '```json',
    `[{"title":"...","brief":"...","pipelineId":"<id>","model":"sonnet"}]`,
    '```',
  ].join('\n')
}

export function parseDrafts(text: string, pipes: AmPipeline[]): Draft[] {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)]
  const last = blocks.pop()
  let arr: any[] = []
  const tryParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  arr = (last && tryParse(last[1])) || tryParse(text)
  if (!Array.isArray(arr)) { const i = text.indexOf('['), j = text.lastIndexOf(']'); arr = i >= 0 && j > i ? tryParse(text.slice(i, j + 1)) : null }
  if (!Array.isArray(arr)) return []
  const ids = new Set(pipes.map((p) => p.id))
  return arr.filter((d) => d && d.title).map((d) => ({
    title: String(d.title).slice(0, 140),
    brief: String(d.brief || ''),
    pipelineId: ids.has(d.pipelineId) ? d.pipelineId : (pipes[0]?.id || ''),
    model: d.model === 'opus' ? 'opus' : 'sonnet',
    defer: false,
    dependsOn: typeof d.dependsOn === 'number' ? d.dependsOn : undefined, // index task phải xong trước (thứ tự)
  }))
}

export default function Planner({ project, pipes, onDone, onClose }: { project: string; pipes: AmPipeline[]; onDone: () => void; onClose: () => void }) {
  const [goal, setGoal] = useState('')
  const [phase, setPhase] = useState<'idle' | 'thinking' | 'review' | 'creating'>('idle')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [err, setErr] = useState('')
  const [elapsed, setElapsed] = useState(0)

  const plan = async () => {
    if (!goal.trim()) return
    setErr(''); setPhase('thinking'); setElapsed(0)
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    try {
      const { job_id } = await send(buildDraftPrompt(goal.trim(), project, pipes), false)
      let res = ''
      for (let i = 0; i < 120; i++) { // tối đa ~2 phút
        await new Promise((s) => setTimeout(s, 1200))
        const p = await poll(job_id)
        if (p.result != null) { res = p.result; break }
        if (p.status === 'error' || p.status === 'failed') { throw new Error('bridge lỗi') }
      }
      const ds = parseDrafts(res, pipes)
      if (!ds.length) { setErr('Lucy không trả JSON card hợp lệ — thử mô tả rõ hơn.'); setPhase('idle') }
      else { setDrafts(ds); setPhase('review') }
    } catch (e) { setErr('Lỗi: ' + String(e).slice(0, 140)); setPhase('idle') } finally { clearInterval(t) }
  }

  const createAll = async () => {
    setPhase('creating')
    for (const d of drafts) await amCreateCard(d.title, d.brief, d.pipelineId, project, d.defer, d.model)
    onDone(); onClose()
  }

  const upd = (i: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d, k) => (k === i ? { ...d, ...patch } : d)))
  const del = (i: number) => setDrafts((ds) => ds.filter((_, k) => k !== i))

  return (
    <div className="shrink-0 border-b border-line bg-panel/40 px-4 sm:px-5 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[13px] font-semibold text-cyan">✨ Lucy lập kế hoạch</span>
        <span className="text-[11px] text-inkfaint">dự án: {project === 'all' ? 'default' : project}</span>
        <button className="btn btn-icon !w-7 !h-7 ml-auto" onClick={onClose}>✕</button>
      </div>

      {(phase === 'idle' || phase === 'thinking') && (
        <div className="flex flex-col sm:flex-row gap-2">
          <textarea className="input flex-1 !h-auto" rows={2} placeholder="Tả mục tiêu… (vd: làm trang landing bán khoá học + form đăng ký + blog 3 bài). Lucy sẽ tự chia card."
            value={goal} onChange={(e) => setGoal(e.target.value)} disabled={phase === 'thinking'} />
          <button className="btn btn-primary shrink-0 self-start" onClick={plan} disabled={phase === 'thinking' || !goal.trim()}>
            {phase === 'thinking' ? `Lucy đang nghĩ… ${elapsed}s` : '✨ Lập kế hoạch'}
          </button>
        </div>
      )}
      {err && <div className="text-[12px] text-pink mt-2">{err}</div>}

      {(phase === 'review' || phase === 'creating') && (
        <div className="flex flex-col gap-2">
          <div className="text-[12px] text-inkdim">Lucy đề xuất <b className="text-ink">{drafts.length}</b> card — sửa/bỏ rồi tạo:</div>
          {drafts.map((d, i) => (
            <div key={i} className="card !bg-black/20 p-2.5 flex flex-col sm:flex-row gap-2 sm:items-center">
              <input className="input flex-1 !py-1.5 text-[13px]" value={d.title} onChange={(e) => upd(i, { title: e.target.value })} />
              <select className="input sm:!w-36 !py-1.5 text-[12px]" value={d.pipelineId} onChange={(e) => upd(i, { pipelineId: e.target.value })}>
                {pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select className="input sm:!w-24 !py-1.5 text-[12px]" value={d.model} onChange={(e) => upd(i, { model: e.target.value as 'sonnet' | 'opus' })}>
                <option value="sonnet">sonnet</option>
                <option value="opus">opus</option>
              </select>
              <label className="flex items-center gap-1 text-[11px] text-inkdim cursor-pointer shrink-0" title="tạo nhưng để sau, không chạy ngay">
                <input type="checkbox" checked={d.defer} onChange={(e) => upd(i, { defer: e.target.checked })} />🕓
              </label>
              <button className="btn btn-icon !w-7 !h-7 shrink-0" title="bỏ card này" onClick={() => del(i)}>🗑</button>
            </div>
          ))}
          <div className="flex gap-2 mt-1">
            <button className="btn btn-primary" onClick={createAll} disabled={phase === 'creating' || !drafts.length}>
              {phase === 'creating' ? 'Đang tạo…' : `✓ Tạo ${drafts.length} card`}
            </button>
            <button className="btn" onClick={() => { setPhase('idle'); setDrafts([]) }}>Soạn lại</button>
          </div>
          <div className="text-[11px] text-inkfaint">Brief đầy đủ xem/sửa được sau khi tạo (mở card). Card sẽ vào dự án "{project === 'all' ? 'default' : project}".</div>
        </div>
      )}
    </div>
  )
}
