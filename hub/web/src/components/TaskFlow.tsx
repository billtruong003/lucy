// DAG phụ thuộc task — vẽ A→B→C các card có quan hệ blockedBy (task/việc-con phải xong trước).
// Layout tầng TRÁI→PHẢI (topo sort đơn giản: level = đường dài nhất từ gốc). Card độc lập
// (không phụ thuộc ai + không ai phụ thuộc) KHÔNG vẽ để đỡ rối. Node = thẻ mini màu theo status Kanban.
import { useMemo } from 'react'
import type { AmCard } from '../api'

type StatusMeta = Record<string, { label: string; color: string; icon: string }>
const COL_W = 210
const ROW_H = 70
const NODE_W = 168
const NODE_H = 46
const PAD = 28

export default function TaskFlow({ cards, status, sel, onSelect }: { cards: AmCard[]; status: StatusMeta; sel: string | null; onSelect: (id: string) => void }) {
  const { nodes, links, width, height } = useMemo(() => {
    const byId = new Map(cards.map((c) => [c.id, c]))
    // edge dep→card: card.blockedBy[i] là việc phải xong TRƯỚC (chỉ giữ dep có thật trong danh sách)
    const rawLinks: { from: string; to: string }[] = []
    for (const c of cards) for (const dep of c.blockedBy || []) if (byId.has(dep) && dep !== c.id) rawLinks.push({ from: dep, to: c.id })
    const involved = new Set<string>()
    for (const l of rawLinks) { involved.add(l.from); involved.add(l.to) }
    const nodeIds = [...involved]
    if (!nodeIds.length) return { nodes: [], links: [], width: 0, height: 0 }

    // parents = dep đến node → level(node) = max(level(dep))+1 (longest-path, guard vòng lặp)
    const parents = new Map<string, string[]>()
    for (const l of rawLinks) parents.set(l.to, [...(parents.get(l.to) || []), l.from])
    const levelOf = new Map<string, number>()
    const lvl = (id: string, stack: Set<string>): number => {
      const cached = levelOf.get(id); if (cached != null) return cached
      if (stack.has(id)) return 0   // vòng lặp → chặn đệ quy
      stack.add(id)
      const ps = parents.get(id) || []
      const l = ps.length ? Math.max(...ps.map((p) => lvl(p, stack) + 1)) : 0
      stack.delete(id); levelOf.set(id, l); return l
    }
    for (const id of nodeIds) lvl(id, new Set())

    // gom theo tầng → xếp Y trong tầng (ổn định theo title)
    const byLevel = new Map<number, string[]>()
    for (const id of nodeIds) { const l = levelOf.get(id) || 0; byLevel.set(l, [...(byLevel.get(l) || []), id]) }
    const pos = new Map<string, { x: number; y: number }>()
    let maxRow = 0, maxLevel = 0
    for (const [l, ids] of byLevel) {
      ids.sort((a, b) => (byId.get(a)?.title || '').localeCompare(byId.get(b)?.title || ''))
      ids.forEach((id, i) => pos.set(id, { x: PAD + l * COL_W, y: PAD + i * ROW_H }))
      maxRow = Math.max(maxRow, ids.length); maxLevel = Math.max(maxLevel, l)
    }
    const nodes = nodeIds.map((id) => ({ id, card: byId.get(id)!, ...pos.get(id)! }))
    const links = rawLinks.map((l) => ({ ...l, a: pos.get(l.from)!, b: pos.get(l.to)! }))
    return { nodes, links, width: PAD * 2 + maxLevel * COL_W + NODE_W, height: PAD * 2 + maxRow * ROW_H }
  }, [cards])

  if (!nodes.length) return (
    <div className="h-full grid place-items-center p-6 text-center">
      <div className="text-inkfaint text-sm max-w-sm">
        <div className="text-2xl mb-2">🔗</div>
        Chưa có task nào phụ thuộc nhau. Tạo card với "chờ task khác" thì luồng A→B→C sẽ hiện ở đây.
      </div>
    </div>
  )

  return (
    <div className="h-full overflow-auto p-3 sm:p-4">
      <svg width={Math.max(width, 320)} height={Math.max(height, 160)} className="min-w-full">
        <defs>
          <marker id="tf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#3fd3ff99" />
          </marker>
        </defs>
        {/* edges: từ mép phải node dep → mép trái node phụ thuộc, cong nhẹ */}
        {links.map((l, i) => {
          const x1 = l.a.x + NODE_W, y1 = l.a.y + NODE_H / 2
          const x2 = l.b.x, y2 = l.b.y + NODE_H / 2
          const mx = (x1 + x2) / 2
          return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="#3fd3ff55" strokeWidth={1.4} markerEnd="url(#tf-arrow)" />
        })}
        {/* nodes: thẻ mini, thanh trái màu status, click → mở drawer */}
        {nodes.map((n) => {
          const meta = status[n.card.status] || { label: n.card.status, color: '#8aa0b5', icon: '·' }
          const isSel = sel === n.id
          const title = n.card.title.length > 30 ? n.card.title.slice(0, 29) + '…' : n.card.title
          return (
            <g key={n.id} transform={`translate(${n.x},${n.y})`} className="cursor-pointer" onClick={() => onSelect(n.id)}>
              <rect width={NODE_W} height={NODE_H} rx={9} fill="#0e1420" stroke={isSel ? '#3fd3ff' : meta.color + '55'} strokeWidth={isSel ? 1.8 : 1} />
              <rect width={4} height={NODE_H} rx={2} fill={meta.color} />
              <text x={14} y={19} fontSize={11.5} fill="#e6edf5" style={{ fontFamily: 'inherit', fontWeight: 600 }}>{title}</text>
              <text x={14} y={35} fontSize={9} fill={meta.color} style={{ fontFamily: 'JetBrains Mono, monospace' }}>{meta.icon} {meta.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
