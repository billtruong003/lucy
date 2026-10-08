// Design — kitchen-sink: nguồn hình chuẩn của design-system Cockpit v2.
// Render mọi token + primitive để verify nhất quán (dev/QA + chủ nhân review).
import { Card, Stat, Chip, Button, Skeleton, SkeletonCard, EmptyState, ErrorState, Eyebrow } from './ui'
import { Sparkles } from 'lucide-react'

function Swatch({ name, varName }: { name: string; varName: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-8 w-8 rounded-md border border-line shrink-0" style={{ background: `var(${varName})` }} />
      <div className="min-w-0">
        <div className="text-[12px] text-inkdim truncate">{name}</div>
        <div className="text-[10px] text-inkfaint num truncate">{varName}</div>
      </div>
    </div>
  )
}

const SURFACES = [['Canvas', '--surface-canvas'], ['Surface 1', '--surface-1'], ['Surface 2', '--surface-2'], ['Surface 3', '--surface-3'], ['Surface 4', '--surface-4']]
const ACCENTS = [['Accent', '--accent'], ['Value', '--value'], ['Success', '--success'], ['Warning', '--warning'], ['Danger', '--danger']]
const VIZ = ['--viz-1', '--viz-2', '--viz-3', '--viz-4', '--viz-5', '--viz-6', '--viz-7', '--viz-8']
const TYPE = [['Display 20 · Space Grotesk', 'display text-lg'], ['Body 14 · Inter', 'text-base'], ['Meta 12', 'text-xs text-inkdim'], ['Số 32 · JetBrains Mono', 'num text-2xl text-cyan']]

export default function Design() {
  return (
    <div className="h-full overflow-auto px-4 sm:px-6 py-5">
      <div className="max-w-4xl mx-auto flex flex-col gap-8">
        <div>
          <h1 className="display text-lg text-ink">Design System — Cockpit v2</h1>
          <p className="text-xs text-inkfaint mt-1">Nguồn hình chuẩn: token + primitive. Component nên tái dùng mấy cái này.</p>
        </div>

        <section>
          <Eyebrow>Surfaces · elevation ladder</Eyebrow>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-3">{SURFACES.map(([n, v]) => <Swatch key={v} name={n} varName={v} />)}</div>
        </section>

        <section>
          <Eyebrow>Accents (semantic)</Eyebrow>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-3">{ACCENTS.map(([n, v]) => <Swatch key={v} name={n} varName={v} />)}</div>
        </section>

        <section>
          <Eyebrow>Data-viz palette</Eyebrow>
          <div className="flex flex-wrap gap-2 mt-3">{VIZ.map((v, i) => <span key={v} className="h-8 w-8 rounded-md border border-line" style={{ background: `var(${v})` }} title={`viz-${i + 1}`} />)}</div>
        </section>

        <section>
          <Eyebrow>Typography</Eyebrow>
          <div className="flex flex-col gap-2 mt-3">{TYPE.map(([t, c]) => <div key={t} className={c as string}>{t}</div>)}</div>
        </section>

        <section>
          <Eyebrow>Stat / KPI</Eyebrow>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <Stat label="Token / ngày" value="81.9M" hint="mọi nguồn" />
            <Stat label="Chi phí" value="$70.4" tone="value" hint="tháng này" />
            <Stat label="Xong" value="24" tone="success" />
            <Stat label="Lỗi" value="2" tone="danger" />
          </div>
        </section>

        <section>
          <Eyebrow>Buttons</Eyebrow>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button variant="primary">Primary</Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button disabled>Disabled</Button>
          </div>
        </section>

        <section>
          <Eyebrow>Chips</Eyebrow>
          <div className="flex flex-wrap gap-2 mt-3">
            <Chip>neutral</Chip><Chip tone="accent">accent</Chip><Chip tone="value">value</Chip>
            <Chip tone="success">success</Chip><Chip tone="warning">warning</Chip><Chip tone="danger">danger</Chip>
          </div>
        </section>

        <section>
          <Eyebrow>Card · hover-raise · input</Eyebrow>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <Card raise className="p-4"><div className="text-sm text-inkdim">Card (hover để nâng)</div></Card>
            <input className="input" placeholder="Input mẫu…" />
          </div>
        </section>

        <section>
          <Eyebrow>States: loading · empty · error</Eyebrow>
          <div className="grid sm:grid-cols-3 gap-3 mt-3">
            <SkeletonCard />
            <Card><EmptyState icon={<Sparkles size={28} strokeWidth={1.5} />} title="Chưa có gì" hint="Thêm mục đầu tiên để bắt đầu." action={<Button variant="primary">Tạo mới</Button>} /></Card>
            <Card><ErrorState message="fetch failed: coordinator offline" onRetry={() => {}} /></Card>
          </div>
        </section>
      </div>
    </div>
  )
}
