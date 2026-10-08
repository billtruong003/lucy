// PageShell — khung trang chuẩn cho mọi tab: padding responsive + measure + scroll container thống nhất.
// Trước đây mỗi tab tự đoán px-6/px-4/px-5 (7 tab không có breakpoint mobile). Dùng cái này để hết lệch.
import type { ReactNode } from 'react'

const cx = (...a: (string | false | undefined)[]) => a.filter(Boolean).join(' ')

export default function PageShell({ title, sub, actions, width = 'content', pad = true, scroll = true, className, children }: {
  title?: ReactNode          // tiêu đề trong trang (tuỳ chọn — App đã có header chung)
  sub?: ReactNode
  actions?: ReactNode        // nút/segment bên phải tiêu đề
  width?: 'content' | 'wide' | 'full'  // measure: content=max-w-4xl · wide=max-w-6xl · full
  pad?: boolean
  scroll?: boolean
  className?: string
  children: ReactNode
}) {
  const maxW = width === 'content' ? 'max-w-4xl' : width === 'wide' ? 'max-w-6xl' : ''
  return (
    <div className={cx('h-full', scroll && 'overflow-auto', pad && 'px-4 sm:px-6 py-4 sm:py-5', className)}>
      <div className={cx(maxW, maxW && 'mx-auto')}>
        {(title || actions) && (
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              {title && <h1 className="display text-lg text-ink leading-tight truncate">{title}</h1>}
              {sub && <p className="text-xs text-inkfaint mt-0.5 truncate">{sub}</p>}
            </div>
            {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
