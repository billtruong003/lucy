import { useEffect, useState } from 'react'
import BrainViz from './BrainViz'
import Galaxy from './Galaxy'
import Constellation from './Constellation'
import KGraph from './KGraph'
import { onGalaxyFocus } from '../galaxyFocus'

// Tab Neural có 4 chế độ:
//  • Constellation = brain viz HUD (mặc định — lõi Lucy tâm, node theo zone, hover ra fact)
//  • Tinh hà       = Galaxy 3D cũ (giữ lại)
//  • Cây tri thức  = KGraph tree (GitNexus-style folder tree: vault + tài nguyên VPS)
//  • Live          = BrainViz telemetry agent đang chạy
export default function NeuralTab({ visible }: { visible: boolean }) {
  const [mode, setMode] = useState<'constel' | 'galaxy' | 'tree' | 'live'>('constel')
  useEffect(() => onGalaxyFocus(() => setMode('galaxy')), [])
  return (
    <div className="relative h-full w-full">
      <div className={'absolute inset-0 ' + (mode === 'constel' ? '' : 'opacity-0 pointer-events-none')}><Constellation visible={visible && mode === 'constel'} /></div>
      <div className={'absolute inset-0 ' + (mode === 'live' ? '' : 'opacity-0 pointer-events-none')}><BrainViz visible={visible && mode === 'live'} /></div>
      <div className={'absolute inset-0 ' + (mode === 'galaxy' ? '' : 'opacity-0 pointer-events-none')}><Galaxy visible={visible && mode === 'galaxy'} /></div>
      <div className={'absolute inset-0 ' + (mode === 'tree' ? '' : 'opacity-0 pointer-events-none')}><KGraph visible={visible && mode === 'tree'} /></div>

      {/* toggle HUD */}
      <div className="absolute top-3 right-4 z-30 flex items-center gap-0.5 card !bg-surface4 p-0.5">
        {([['constel', '✦ HUD'], ['galaxy', '🌌 3D'], ['tree', '🌳 Cây'], ['live', '⚡ Live']] as const).map(([m, lb]) => (
          <button key={m} onClick={() => setMode(m)}
            className={'px-3 py-1.5 rounded text-[12px] font-medium transition-colors ' + (mode === m ? 'bg-cyan/15 text-cyan' : 'text-inkdim hover:text-ink')}>{lb}</button>
        ))}
      </div>
    </div>
  )
}
