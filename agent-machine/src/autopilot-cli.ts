// Sprint CLI — "tối t kêu dự án chạy": Okabe (opus) tự đẻ sprint card cho 1 dự án rồi đẩy vào hàng chạy.
// Dùng: tsx src/autopilot-cli.ts sprint <projectId> "<mục tiêu đêm nay>"
import { generateSprint } from './autopilot'
import type { Card, Project, Pipeline } from './types'

const URL = process.env.AM_COORD_URL || 'http://127.0.0.1:8780'
const TOKEN = process.env.AM_TOKEN || ''
const headers: Record<string, string> = { 'content-type': 'application/json', ...(TOKEN ? { 'x-worker-token': TOKEN } : {}) }

async function main(): Promise<void> {
  const [, , cmd, projectId, ...rest] = process.argv
  const goal = rest.join(' ').trim()
  if (cmd !== 'sprint' || !projectId || !goal) {
    console.error('dùng: tsx src/autopilot-cli.ts sprint <projectId> "<mục tiêu>"')
    process.exit(1)
  }
  const state: { projects?: Project[]; pipelines?: Pipeline[]; cards?: Card[] } = await fetch(URL + '/state', { headers }).then((r) => r.json())
  const project = (state.projects || []).find((p) => p.id === projectId) || { id: projectId, name: projectId }
  const pipelines = (state.pipelines || []).map((p) => p.id)
  if (!pipelines.length) { console.error('Coordinator chưa có pipeline nào — không đẻ được.'); process.exit(1) }
  const existing = (state.cards || []).filter((c) => (c.projectId || 'default') === projectId).map((c) => c.title)

  console.log(`🧠 Okabe đang chia sprint cho "${project.name}" — mục tiêu: ${goal}`)
  const cards = await generateSprint({ projectName: project.name, projectId, goal, pipelines, existingTitles: existing })
  if (!cards.length) { console.error('Okabe không sinh được card (model lỗi / mục tiêu mơ hồ / pipeline không khớp).'); process.exit(1) }

  for (const c of cards) {
    await fetch(URL + '/card', { method: 'POST', headers, body: JSON.stringify({ title: c.title, brief: c.brief, pipelineId: c.pipelineId, projectId }) })
    console.log(`  ➕ [${c.pipelineId}] ${c.title}`)
  }
  console.log(`✅ đẻ ${cards.length} card cho "${project.name}" → đang chạy. Bật autopilot để Lucy duyệt thay ở gate.`)
}
main().catch((e) => { console.error(e); process.exit(1) })
