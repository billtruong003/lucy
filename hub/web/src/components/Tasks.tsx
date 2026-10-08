import { EmptyState } from './ui'
import { useEffect, useState } from 'react'
import { jobs, poll, send, type JobRow } from '../api'
import { showToast } from '../toast'
import Markdown from './Markdown'

// S3/E3.4 — Task pipeline kiểu kanban: cột theo status (Đang chạy · Hoàn tất),
// mở card → kết quả live (poll), "Chạy lại" = phát lại prompt (model giữ nguyên).
// Hub job chỉ có 2 trạng thái (running/done) → 2 cột; không có 'failed' nên không lọc-lỗi giả.

const isOpus = (model: string) => /opus/i.test(model)

export default function Tasks() {
  const [rows, setRows] = useState<JobRow[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({}) // id -> result (đã tải). Thiếu key = chưa tải.
  const [rerunning, setRerunning] = useState<string | null>(null)
  useEffect(() => {
    const f = async () => {
      try { const d = await jobs(); setRows(d.jobs || []) } catch { /* */ }
      if (openId) { try { const p = await poll(openId); setResults((r) => ({ ...r, [openId]: p.result || '' })) } catch { /* */ } } // job đang mở -> cập nhật result live
    }
    f(); const t = setInterval(f, 3000); return () => clearInterval(t)
  }, [openId])

  // mở 1 task -> tải full kết quả (poll trả result) -> render Markdown có cách dòng
  const toggle = async (j: JobRow) => {
    if (openId === j.id) { setOpenId(null); return }
    setOpenId(j.id)
    try { const p = await poll(j.id); setResults((r) => ({ ...r, [j.id]: p.result || '' })) }
    catch { setResults((r) => ({ ...r, [j.id]: '' })) }
  }

  // S3/E3.4 — chạy lại: phát lại prompt cũ, giữ nguyên tier model
  const rerun = async (j: JobRow, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!j.prompt || rerunning) return
    setRerunning(j.id)
    try { await send(j.prompt, isOpus(j.model)); showToast('Đã phát lại task', 'success') }
    catch { showToast('Lỗi khi chạy lại', 'error') }
    finally { setRerunning(null) }
    try { const d = await jobs(); setRows(d.jobs || []) } catch { /* */ }
  }

  const running = rows.filter((r) => r.status === 'running')
  const done = rows.filter((r) => r.status !== 'running')

  const Card = ({ j }: { j: JobRow }) => {
    const run = j.status === 'running'
    const isOpen = openId === j.id
    const res = results[j.id]
    return (
      <div className={'glass overflow-hidden ' + (run ? 'border-grn/25' : '')}>
        <button className="w-full px-3.5 py-3 flex items-center gap-3 text-left" onClick={() => toggle(j)}>
          <span className={'grid place-items-center h-7 w-7 rounded-full text-xs shrink-0 ' + (run ? 'text-grn' : 'text-cyan')}
            style={{ background: run ? 'rgba(95,227,154,0.12)' : 'rgba(56,208,255,0.10)', animation: run ? 'lucy-pulse 1.4s infinite' : undefined }}>
            {run ? '⏳' : '✓'}
          </span>
          <span className="flex-1 min-w-0">
            <span className={'block text-[13px] leading-snug ' + (isOpen ? 'break-words' : 'truncate')}>{j.prompt || '(no prompt)'}</span>
            <span className="flex items-center gap-2 mt-0.5">
              <span className="num text-[10px] text-inkfaint uppercase">{j.model}</span>
              <span className="num text-[10px] text-inkfaint">{j.elapsed}s</span>
            </span>
          </span>
          <span className="text-inkfaint text-[11px] shrink-0">{isOpen ? '▾' : '▸'}</span>
        </button>
        {isOpen && (
          <div className="border-t border-line">
            <div className="px-3.5 pb-2.5 pt-1 max-h-[55vh] overflow-auto">
              {res === undefined ? <div className="text-[12px] text-inkfaint py-2">đang tải kết quả…</div>
                : res === '' ? <div className="text-[12px] text-inkfaint py-2">{run ? 'đang chạy — chưa có kết quả' : '(chưa có kết quả)'}</div>
                  : <Markdown>{res}</Markdown>}
            </div>
            {!run && j.prompt && (
              <div className="px-3.5 pb-2.5 flex justify-end">
                <button onClick={(e) => rerun(j, e)} disabled={rerunning === j.id}
                  className="btn !py-1 !px-2.5 text-[11px]">{rerunning === j.id ? '…' : '↻ Chạy lại'}</button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const Column = ({ title, dot, items, empty }: { title: string; dot: string; items: JobRow[]; empty: string }) => (
    <div className="flex flex-col min-w-0">
      <div className="flex items-center gap-2 mb-2.5 px-0.5">
        <span className={'h-1.5 w-1.5 rounded-full ' + dot} />
        <span className="text-[12px] font-semibold text-inkdim">{title}</span>
        <span className="num text-[11px] text-inkfaint">{items.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {items.length === 0
          ? <div className="text-[11px] text-inkfaint py-6 text-center border border-dashed border-line rounded-xl">{empty}</div>
          : items.map((j) => <Card key={j.id} j={j} />)}
      </div>
    </div>
  )

  return (
    <div className="h-full overflow-auto px-4 sm:px-6 py-5">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-2 mb-4 text-sm text-inkdim">
          <span className="chip"><span className={'h-1.5 w-1.5 rounded-full ' + (running.length ? 'bg-grn' : 'bg-inkfaint')} /> {running.length} đang chạy</span>
          <span className="chip">{rows.length} gần đây</span>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="Chưa có task nào" hint="Gửi tin ở tab Chat → task hiện ở đây." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <Column title="Đang chạy" dot="bg-grn" items={running} empty="không có task đang chạy" />
            <Column title="Hoàn tất" dot="bg-cyan" items={done} empty="chưa có task xong" />
          </div>
        )}
      </div>
    </div>
  )
}
