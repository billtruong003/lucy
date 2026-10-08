// dashboard/useDashboardData — 1 nơi fetch mọi dữ liệu dashboard (overview/insights/lucy).
// Trả state + loader; tab component chỉ nhận props, không tự fetch.
import { useEffect, useState } from 'react'
import {
  metricsData, amState, errorStatsData, brainState, llmGuard,
  type MetricsData, type AmCard, type AmPersona, type AmMsg, type BrainSig, type ErrorStatsData, type GuardData,
} from '../../api'
import { EMPTY_METRICS, EMPTY_ERROR_STATS } from './helpers'

export type DashboardData = {
  // overview
  data: MetricsData; oLoading: boolean; lastRefresh: number; guard: GuardData | null; loadOverview: () => void
  // insights
  cards: AmCard[]; personas: AmPersona[]; iLoading: boolean; iOffline: boolean; iConfigured: boolean
  errorStats: ErrorStatsData; loadInsights: () => void
  // cho lucy
  channels: AmMsg[]; brainInbox: BrainSig[]
}

export function useDashboardData(): DashboardData {
  const [data, setData] = useState<MetricsData>(EMPTY_METRICS)
  const [oLoading, setOLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(0)
  const [guard, setGuard] = useState<GuardData | null>(null)

  const [cards, setCards] = useState<AmCard[]>([])
  const [personas, setPersonas] = useState<AmPersona[]>([])
  const [iLoading, setILoading] = useState(true)
  const [iOffline, setIOffline] = useState(false)
  const [iConfigured, setIConfigured] = useState(true)
  const [errorStats, setErrorStats] = useState<ErrorStatsData>(EMPTY_ERROR_STATS)

  const [channels, setChannels] = useState<AmMsg[]>([])
  const [brainInbox, setBrainInbox] = useState<BrainSig[]>([])

  const loadOverview = () => {
    metricsData().then((d) => { setData(d); setLastRefresh(Date.now()) }).catch(() => {}).finally(() => setOLoading(false))
    llmGuard().then(setGuard).catch(() => {})
  }
  const loadInsights = async () => {
    try {
      const s = await amState()
      if (!s.configured) { setIConfigured(false); setILoading(false); return }
      setIOffline(!!s.offline); setCards(s.cards ?? []); setPersonas(s.personas ?? []); setChannels(s.channels ?? [])
    } catch { setIOffline(true) } finally { setILoading(false) }
    try { setErrorStats(await errorStatsData()) } catch { /* giữ state cũ */ }
  }
  const loadLucy = async () => { try { const b = await brainState(); setBrainInbox(b.inbox ?? []) } catch { /* */ } }

  useEffect(() => {
    loadOverview(); loadInsights(); loadLucy()
    const iv1 = setInterval(loadOverview, 12_000)
    const iv2 = setInterval(loadInsights, 10_000)
    const iv3 = setInterval(loadLucy, 30_000)
    return () => { clearInterval(iv1); clearInterval(iv2); clearInterval(iv3) }
  }, [])

  return { data, oLoading, lastRefresh, guard, loadOverview, cards, personas, iLoading, iOffline, iConfigured, errorStats, loadInsights, channels, brainInbox }
}
