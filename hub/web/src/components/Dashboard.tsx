// Dashboard — orchestrator mỏng: inner-tab (segment HUD) + data hook + 3 tab component.
// Logic/JSX từng tab tách ở dashboard/. (Trước là monolith 973 dòng — đã đập ra clean.)
import { useState } from 'react'
import { useDashboardData } from './dashboard/useDashboardData'
import Overview from './dashboard/Overview'
import Insights from './dashboard/Insights'
import ForLucy from './dashboard/ForLucy'

const TABS = [
  { id: 'overview', icon: '📈', label: 'Overview' },
  { id: 'insights', icon: '🔬', label: 'Agent Insights' },
  { id: 'lucy', icon: '🌙', label: 'Cho Lucy' },
] as const

export default function Dashboard() {
  const [innerTab, setInnerTab] = useState<'overview' | 'insights' | 'lucy'>('overview')
  const d = useDashboardData()

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="tabs shrink-0">
        {TABS.map((t) => (
          <button key={t.id} className={'tab-btn' + (innerTab === t.id ? ' active' : '')} onClick={() => setInnerTab(t.id)}>
            <span className="tab-icon">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {innerTab === 'overview' && <Overview data={d.data} guard={d.guard} oLoading={d.oLoading} lastRefresh={d.lastRefresh} onRefresh={d.loadOverview} />}
      {innerTab === 'insights' && <Insights cards={d.cards} personas={d.personas} errorStats={d.errorStats} iLoading={d.iLoading} iOffline={d.iOffline} iConfigured={d.iConfigured} onRefresh={d.loadInsights} />}
      {innerTab === 'lucy' && <ForLucy data={d.data} cards={d.cards} channels={d.channels} brainInbox={d.brainInbox} />}
    </div>
  )
}
