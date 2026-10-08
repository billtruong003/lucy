// ui/ — primitive dùng chung cho toàn hub (design-system Cockpit v2).
// Đọc token semantic (surface/text/accent/border) ở index.css. Đừng hardcode màu/px ở đây.
import type { ReactNode, HTMLAttributes, ButtonHTMLAttributes } from 'react'
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'

const cx = (...a: (string | false | undefined)[]) => a.filter(Boolean).join(' ')

/* ── Card — 1 primitive nội dung (surface-2, radius-md, shadow-sm) ── */
export function Card({ raise, className, children, ...p }: { raise?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('card', raise && 'card-raise', className)} {...p}>{children}</div>
}

/* ── Eyebrow — nhãn section uppercase tracked ── */
export function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('eyebrow', className)}>{children}</div>
}

/* ── Stat — KPI tile: nhãn + số (mono) + đơn vị/delta (+ thanh % tuỳ chọn) ── */
export function Stat({ label, value, unit, tone = 'default', hint, barPct, className }:
  { label: string; value: ReactNode; unit?: string; tone?: 'default' | 'value' | 'success' | 'danger'; hint?: string; barPct?: number; className?: string }) {
  const color = tone === 'value' ? 'text-gold' : tone === 'success' ? 'text-grn' : tone === 'danger' ? 'text-rose' : 'text-cyan'
  return (
    <Card className={cx('p-4', className)}>
      <div className="eyebrow mb-1.5">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={cx('num text-2xl font-bold leading-none', color)}>{value}</span>
        {unit && <span className="text-[11px] text-inkfaint">{unit}</span>}
      </div>
      {typeof barPct === 'number' && <Meter pct={barPct} tone={tone === 'default' ? 'default' : tone} className="mt-2.5" />}
      {hint && <div className="text-[11px] text-inkfaint mt-1.5">{hint}</div>}
    </Card>
  )
}

/* ── Meter — thanh phần trăm ngang (CPU/RAM/disk...), màu theo ngưỡng ── */
export function Meter({ pct, tone = 'default', className }:
  { pct: number; tone?: 'default' | 'value' | 'success' | 'danger'; className?: string }) {
  const clamped = Math.max(0, Math.min(100, pct))
  const bar = tone === 'danger' ? 'bg-rose' : tone === 'value' ? 'bg-gold' : tone === 'success' ? 'bg-grn' : 'bg-cyan'
  return (
    <div className={cx('h-1.5 w-full rounded-full bg-surface3/70 overflow-hidden', className)}>
      <div className={cx('h-full rounded-full transition-[width] duration-500', bar)} style={{ width: `${clamped}%` }} />
    </div>
  )
}

/* ── Chip — badge semantic ── */
export function Chip({ tone, className, children }:
  { tone?: 'accent' | 'value' | 'success' | 'warning' | 'danger'; className?: string; children: ReactNode }) {
  return <span className={cx('chip', tone && `chip-${tone}`, className)}>{children}</span>
}

/* ── Button — variant primary/secondary/ghost/danger ── */
export function Button({ variant = 'secondary', className, children, ...p }:
  { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const v = variant === 'primary' ? 'btn btn-primary'
    : variant === 'ghost' ? 'btn !border-transparent !bg-transparent hover:!bg-surface3'
    : variant === 'danger' ? 'btn !border-rose/40 !text-rose hover:!bg-rose/10'
    : 'btn'
  return <button className={cx(v, className)} {...p}>{children}</button>
}

/* ── Skeleton — loading shape-matched ── */
export function Skeleton({ className, w, h }: { className?: string; w?: string; h?: string }) {
  return <div className={cx('skeleton', className)} style={{ width: w, height: h || '1rem' }} />
}
export function SkeletonCard() {
  return (
    <Card className="p-4">
      <Skeleton w="40%" h="0.7rem" className="mb-3" />
      <Skeleton w="70%" h="1.5rem" className="mb-2" />
      <Skeleton w="55%" h="0.7rem" />
    </Card>
  )
}

/* ── EmptyState — vì sao trống + hành động ── */
export function EmptyState({ icon, title, hint, action }:
  { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="text-inkfaint mb-3">{icon || <Inbox size={30} strokeWidth={1.5} />}</div>
      <div className="text-sm text-inkdim font-medium">{title}</div>
      {hint && <div className="text-[12px] text-inkfaint mt-1.5 max-w-xs">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* ── ErrorState — nguyên nhân + retry ── */
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="text-rose/80 mb-3"><AlertTriangle size={30} strokeWidth={1.5} /></div>
      <div className="text-sm text-inkdim font-medium">Có lỗi khi tải</div>
      {message && <div className="text-[12px] text-inkfaint mt-1.5 max-w-sm break-words">{message}</div>}
      {onRetry && (
        <button onClick={onRetry} className="btn mt-4 !py-1.5 text-xs inline-flex items-center gap-1.5">
          <RefreshCw size={13} /> Thử lại
        </button>
      )}
    </div>
  )
}
