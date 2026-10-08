// dream.ts — "gộp đêm": signal thô (Brain/inbox) → preference (Brain/preferences) → digest (active.md).
// THUẦN DETERMINISTIC, KHÔNG LLM. Pure-ish của (signals, preferences, log, _brain.yaml, now).
// Port thuật toán open-second-brain src/core/brain/{dream,confidence}.ts (xem docs/M1_MEMORY_SPEC.md §Mảnh 3).
// An toàn: snapshot trước khi sửa (.snapshots/, đã gitignore) · ghi temp+rename · no-op run KHÔNG ghi gì (idempotent).
import fs from 'node:fs'
import path from 'node:path'
import { parseFrontmatter, slug } from './vault'
import { recordEvidence, type EvidenceKind } from './evidence'

// ── Config từ _brain.yaml (ngưỡng học) ──
export type BrainCfg = {
  candidate_threshold: number
  unconfirmed_window_days: number
  contradiction_window_days: number
  stale_evidence_days: number
  retire_grace_days: number   // pref retired (expired/stale/rebutted) quá hạn này → XOÁ file (node dọn khỏi galaxy)
  high_min: number
  medium_min: number
}
const DEFAULT_CFG: BrainCfg = {
  candidate_threshold: 2, unconfirmed_window_days: 14, contradiction_window_days: 14,
  stale_evidence_days: 90, retire_grace_days: 30, high_min: 0.75, medium_min: 0.4,
}

export function loadCfg(vaultDir: string): BrainCfg {
  const cfg = { ...DEFAULT_CFG }
  try {
    const raw = fs.readFileSync(path.join(vaultDir, '_brain.yaml'), 'utf8')
    let inConfidence = false
    for (const line of raw.split('\n')) {
      const conf = line.match(/^confidence:\s*$/)
      if (conf) { inConfidence = true; continue }
      const m = line.match(/^(\s*)([a-z_]+):\s*([0-9.]+)/)
      if (!m) { if (line.trim() && !line.startsWith(' ')) inConfidence = false; continue }
      const key = m[2]; const val = Number(m[3])
      if (inConfidence && key === 'high_min') cfg.high_min = val
      else if (inConfidence && key === 'medium_min') cfg.medium_min = val
      else if (key in cfg) (cfg as Record<string, number>)[key] = val
    }
  } catch { /* dùng default */ }
  return cfg
}

// ── Wilson 95% lower bound × freshness (port confidence.ts, copy verbatim — IP nằm ở công thức) ──
export type Band = 'low' | 'medium' | 'high'
export function computeConfidence(applied: number, violated: number, lastEvidenceAt: string | null, cfg: BrainCfg, now: Date): { value: number; band: Band } {
  const n = applied + violated
  let wilsonLow = 0
  if (n > 0) {
    const z = 1.96, z2 = z * z
    const pHat = applied / n
    const denom = 1 + z2 / n
    const centre = (pHat + z2 / (2 * n)) / denom
    const margin = (z * Math.sqrt((pHat * (1 - pHat)) / n + z2 / (4 * n * n))) / denom
    wilsonLow = Math.max(0, centre - margin)
  }
  let freshness = 0
  if (lastEvidenceAt) {
    const ageMs = now.getTime() - Date.parse(lastEvidenceAt)
    if (Number.isFinite(ageMs)) {
      const limitMs = cfg.stale_evidence_days * 24 * 3600 * 1000
      if (limitMs > 0) freshness = Math.max(0, Math.min(1, 1 - ageMs / limitMs))
    }
  }
  const value = Math.round(wilsonLow * freshness * 10000) / 10000
  const band: Band = value >= cfg.high_min ? 'high' : value >= cfg.medium_min ? 'medium' : 'low'
  return { value, band }
}

// ── Data ──
export type Sign = 'positive' | 'negative'
export type Signal = { file: string; id: string; topic: string; signal: Sign; principle: string; scope?: string; agent: string; created_at: string }
export type PrefStatus = 'unconfirmed' | 'confirmed' | 'rebutted' | 'stale' | 'expired'
export type Preference = {
  file: string; id: string; topic: string; sign: Sign; principle: string; scope?: string
  status: PrefStatus; confidence: number; band: Band; applied: number; violated: number
  evidenced_by: string[]; created_at: string; updated_at: string; last_evidence_at: string | null; pinned: boolean
}
export type DreamSummary = {
  changed: boolean
  graduated: string[]      // pref mới (unconfirmed)
  redundant: number        // signal trùng pref đã có
  contradictions: string[] // topic mâu thuẫn chưa đủ ngưỡng
  rebutted: string[]       // pref bị bác
  retired: string[]        // expired/stale
  pruned: string[]         // pref retired quá hạn grace / file trùng topic → XOÁ (node dọn khỏi galaxy)
  confirmed: string[]      // unconfirmed → confirmed nhờ evidence
  expiredSignals: number   // signal quá cửa sổ không bao giờ đủ ngưỡng → dọn (chống inbox phình vô hạn)
  processedSignals: number
  activePrefs: number
}

const isSign = (v: unknown): v is Sign => v === 'positive' || v === 'negative'

function readSignals(vaultDir: string): Signal[] {
  const dir = path.join(vaultDir, 'Brain', 'inbox')
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out: Signal[] = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const file = path.join(dir, name)
    try {
      if (!fs.statSync(file).isFile()) continue
      const { data } = parseFrontmatter(fs.readFileSync(file, 'utf8'))
      if (data.kind !== 'brain-signal' || !data.topic || !isSign(data.signal)) continue // frontmatter hỏng/khác loại → skip
      out.push({
        file, id: String(data.id || name.replace(/\.md$/, '')), topic: String(data.topic), signal: data.signal,
        principle: String(data.principle || ''), scope: data.scope ? String(data.scope) : undefined,
        agent: String(data.agent || 'engine'), created_at: String(data.created_at || new Date(0).toISOString()),
      })
    } catch { /* file lỗi → skip, chạy tiếp */ }
  }
  return out
}

function readPreferences(vaultDir: string): Preference[] {
  const dir = path.join(vaultDir, 'Brain', 'preferences')
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out: Preference[] = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const file = path.join(dir, name)
    try {
      const { data } = parseFrontmatter(fs.readFileSync(file, 'utf8'))
      if (data.kind !== 'brain-preference' || !data.topic) continue
      out.push({
        file, id: String(data.id || name.replace(/\.md$/, '')), topic: String(data.topic),
        sign: isSign(data.sign) ? data.sign : 'positive', principle: String(data.principle || ''),
        scope: data.scope ? String(data.scope) : undefined,
        status: (['unconfirmed', 'confirmed', 'rebutted', 'stale', 'expired'] as const).find((s) => s === data.status) || 'unconfirmed',
        confidence: Number(data.confidence) || 0, band: (data.band as Band) || 'low',
        applied: Number(data.applied) || 0, violated: Number(data.violated) || 0,
        evidenced_by: Array.isArray(data.evidenced_by) ? (data.evidenced_by as unknown[]).map(String) : [],
        created_at: String(data.created_at || new Date().toISOString()),
        updated_at: String(data.updated_at || data.created_at || new Date().toISOString()),
        last_evidence_at: data.last_evidence_at ? String(data.last_evidence_at) : null,
        pinned: data.pinned === true || data.pinned === 'true',
      })
    } catch { /* skip */ }
  }
  return out
}

// evidence applied/violated từ Brain/log/*.jsonl ({ts, prefId, kind:'applied'|'violated'}). Chưa có → 0.
function readEvidence(vaultDir: string): Map<string, { applied: number; violated: number; last: string | null }> {
  const dir = path.join(vaultDir, 'Brain', 'log')
  const map = new Map<string, { applied: number; violated: number; last: string | null }>()
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return map }
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    let lines: string[]
    try { lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n') } catch { continue }
    for (const ln of lines) {
      if (!ln.trim()) continue
      try {
        const e = JSON.parse(ln) as { ts?: number; prefId?: string; kind?: string }
        if (!e.prefId || (e.kind !== 'applied' && e.kind !== 'violated')) continue
        const cur = map.get(e.prefId) || { applied: 0, violated: 0, last: null }
        if (e.kind === 'applied') cur.applied++; else cur.violated++
        const iso = e.ts ? new Date(e.ts).toISOString() : null
        if (iso && (!cur.last || iso > cur.last)) cur.last = iso
        map.set(e.prefId, cur)
      } catch { /* dòng hỏng → skip */ }
    }
  }
  return map
}

// ── DREAM ──
export function dream(vaultDir: string, opts: { now?: Date } = {}): DreamSummary {
  const now = opts.now || new Date()
  const cfg = loadCfg(vaultDir)
  const signals = readSignals(vaultDir)
  const prefs = readPreferences(vaultDir)
  const evidence = readEvidence(vaultDir)
  const byTopic = new Map<string, Preference>()
  for (const p of prefs) byTopic.set(p.topic, p)

  const summary: DreamSummary = { changed: false, graduated: [], redundant: 0, contradictions: [], rebutted: [], retired: [], pruned: [], confirmed: [], expiredSignals: 0, processedSignals: 0, activePrefs: 0 }
  // gom thay đổi rồi GHI 1 LẦN (no-op → không đụng đĩa)
  const toProcess: string[] = []            // signal files → inbox/processed/
  const prefWrites: Preference[] = []       // pref tạo/đổi → ghi
  const toPrune: string[] = []              // pref file → XOÁ (retired quá grace / trùng topic)
  const logLines: string[] = []
  // A1 evidence: event applied/violated sinh trong run → (a) bump map để confidence tính NGAY run này,
  // (b) persist xuống Brain/log để bền. Signal đã move processed → run sau KHÔNG double-count.
  const evPersist: { ts: number; prefId: string; kind: EvidenceKind }[] = []
  const pushEv = (prefId: string, kind: EvidenceKind) => {
    const cur = evidence.get(prefId) || { applied: 0, violated: 0, last: null }
    if (kind === 'applied') cur.applied++; else cur.violated++
    const iso = now.toISOString()
    if (!cur.last || iso > cur.last) cur.last = iso
    evidence.set(prefId, cur)
    evPersist.push({ ts: now.getTime(), prefId, kind })
  }

  // 1) GRADUATE / CONTRADICTION / REBUTTAL — group signal theo topic
  const windowMs = cfg.contradiction_window_days * 24 * 3600 * 1000
  const groups = new Map<string, Signal[]>()
  for (const s of signals) {
    // ngoài cửa sổ = KHÔNG BAO GIỜ đủ ngưỡng nữa → dọn sang processed (trước đây `continue` suông → kẹt inbox vĩnh viễn)
    if (now.getTime() - Date.parse(s.created_at) > windowMs) {
      toProcess.push(s.file); summary.expiredSignals++
      logLines.push(`expire-signal sig=${s.id} topic="${s.topic}" (quá ${cfg.contradiction_window_days} ngày không đủ ngưỡng)`)
      continue
    }
    const g = groups.get(s.topic) || []
    g.push(s); groups.set(s.topic, g)
  }
  // TRUST-WEIGHT: feedback Bill / bootstrap (rút từ ký ức đã xác lập) = nguồn tin cậy cao → đếm ×2
  // (1 signal đủ ngưỡng graduate luôn). Signal máy (engine/distill/lucy) = ×1, cần lặp lại như cũ.
  const W = (s: Signal) => (s.agent === 'bill' || s.agent === 'bootstrap') ? 2 : 1
  for (const [topic, sigs] of groups) {
    const pos = sigs.filter((s) => s.signal === 'positive')
    const neg = sigs.filter((s) => s.signal === 'negative')
    const posW = pos.reduce((a, s) => a + W(s), 0)
    const negW = neg.reduce((a, s) => a + W(s), 0)
    const domSign: Sign = posW >= negW ? 'positive' : 'negative'
    const dom = domSign === 'positive' ? pos : neg
    const min = domSign === 'positive' ? neg : pos
    const domW = domSign === 'positive' ? posW : negW
    const existing = byTopic.get(topic)

    // cả 2 dấu mà bên trội CHƯA đủ ngưỡng → mâu thuẫn (open question), giữ nguyên signal trong inbox
    if (min.length > 0 && domW < cfg.candidate_threshold) {
      summary.contradictions.push(topic)
      logLines.push(`contradiction topic="${topic}" pos=${posW} neg=${negW} (chờ thêm tín hiệu)`)
      continue
    }
    if (domW < cfg.candidate_threshold) continue // chưa đủ ngưỡng, không mâu thuẫn → chờ

    // đủ ngưỡng: minority bị "huỷ" (out-voted) → đưa processed
    for (const s of min) { toProcess.push(s.file); logLines.push(`cancel-minority sig=${s.id} topic="${topic}"`) }

    if (existing && existing.sign === domSign) {
      // 3) redundant cùng dấu → rule TÁI DIỄN = evidence 'applied' (A1). noted-redundant, KHÔNG tạo trùng.
      for (const s of dom) { toProcess.push(s.file); pushEv(existing.id, 'applied') }
      summary.redundant += dom.length
      logLines.push(`redundant topic="${topic}" +${dom.length} → applied×${dom.length} (pref ${existing.id})`)
    } else if (existing && existing.sign !== domSign && domW >= cfg.candidate_threshold) {
      // 4) rebuttal: tín hiệu ngược đủ ngưỡng = evidence 'violated' (A1) → retire pref (trừ pinned)
      for (const s of dom) { toProcess.push(s.file); pushEv(existing.id, 'violated') }
      if (existing.pinned) { logLines.push(`rebuttal-blocked topic="${topic}" (pref ${existing.id} pinned)`) }
      else {
        const r: Preference = { ...existing, status: 'rebutted', updated_at: now.toISOString() }
        prefWrites.push(r); byTopic.set(topic, r); summary.rebutted.push(existing.id)
        logLines.push(`rebutted pref=${existing.id} topic="${topic}" by ${dom.length} signal ngược dấu`)
      }
    } else {
      // tạo preference UNCONFIRMED mới. principle: ưu tiên câu chữ từ nguồn trust cao (bill/bootstrap).
      const lead = dom.find((s) => W(s) === 2) || dom[0]
      const id = `pref-${slug(topic) || 'x'}`
      const pref: Preference = {
        file: path.join(vaultDir, 'Brain', 'preferences', id + '.md'),
        id, topic, sign: domSign, principle: lead.principle, scope: lead.scope,
        status: 'unconfirmed', confidence: 0, band: 'low', applied: 0, violated: 0,
        evidenced_by: [...new Set(dom.map((s) => s.id))], created_at: now.toISOString(),
        updated_at: now.toISOString(), last_evidence_at: null, pinned: false,
      }
      for (const s of dom) toProcess.push(s.file)
      prefWrites.push(pref); byTopic.set(topic, pref); summary.graduated.push(id)
      logLines.push(`graduate pref=${id} sign=${domSign} topic="${topic}" evidence=${dom.length}`)
    }
  }

  // 2) CONFIDENCE + AUTO-RETIRE cho mọi preference đang sống
  for (const p of prefs) {
    const updated = prefWrites.find((w) => w.id === p.id) // bản vừa đổi ở trên (rebutted)
    const base = updated || p
    if (base.status === 'rebutted' || base.status === 'expired' || base.status === 'stale') continue
    const ev = evidence.get(p.id)
    const applied = ev?.applied ?? 0, violated = ev?.violated ?? 0
    const last = ev?.last ?? p.last_evidence_at
    const { value, band } = computeConfidence(applied, violated, last, cfg, now)
    let status: PrefStatus = base.status
    if (base.status === 'unconfirmed' && applied > 0) { status = 'confirmed'; summary.confirmed.push(p.id) }
    // auto-retire (pinned miễn)
    if (!p.pinned) {
      const ageDays = (now.getTime() - Date.parse(p.created_at)) / (24 * 3600 * 1000)
      if (status === 'unconfirmed' && applied + violated === 0 && ageDays > cfg.unconfirmed_window_days) { status = 'expired'; summary.retired.push(p.id) }
      else if (status === 'confirmed' && last && (now.getTime() - Date.parse(last)) / (24 * 3600 * 1000) > cfg.stale_evidence_days) { status = 'stale'; summary.retired.push(p.id) }
    }
    const changed = status !== p.status || applied !== p.applied || violated !== p.violated || Math.abs(value - p.confidence) > 1e-9 || band !== p.band || last !== p.last_evidence_at
    if (changed && !updated) {
      prefWrites.push({ ...p, status, confidence: value, band, applied, violated, last_evidence_at: last, updated_at: now.toISOString() })
      if (status !== p.status) logLines.push(`pref=${p.id} ${p.status}→${status} conf=${value} (${band})`)
    } else if (updated) {
      // bản rebutted: vẫn cập nhật confidence để hiển thị
      updated.confidence = value; updated.band = band
    }
  }

  // 2b) PRUNE: pref retired (expired/stale/rebutted) quá hạn grace → XOÁ file → galaxy hết node chết.
  //     pinned MIỄN. Chỉ xoá khi qua grace (giữ "Gần đây gỡ bỏ" 1 thời gian). Snapshot đã backup → recover được.
  const graceMs = cfg.retire_grace_days * 24 * 3600 * 1000
  const effective = (p: Preference): Preference => prefWrites.find((w) => w.id === p.id) || p
  const dropWrite = (id: string) => { const i = prefWrites.findIndex((w) => w.id === id); if (i >= 0) prefWrites.splice(i, 1) }
  for (const p of prefs) {
    const e = effective(p)
    if (e.pinned) continue
    if (e.status === 'expired' || e.status === 'stale' || e.status === 'rebutted') {
      const age = now.getTime() - Date.parse(e.updated_at)
      if (Number.isFinite(age) && age > graceMs) {
        dropWrite(p.id); toPrune.push(p.file); summary.pruned.push(p.id)
        logLines.push(`prune pref=${p.id} (${e.status} quá ${cfg.retire_grace_days} ngày) → xoá`)
      }
    }
  }
  // 2c) DEDUP: nhiều file pref CÙNG topic (do ghi lỗi/đổi slug) → giữ bản tốt nhất, xoá phần còn lại.
  const byTopicFiles = new Map<string, Preference[]>()
  for (const p of prefs) { const a = byTopicFiles.get(p.topic) || []; a.push(p); byTopicFiles.set(p.topic, a) }
  const rank = (s: PrefStatus) => (s === 'confirmed' ? 2 : s === 'unconfirmed' ? 1 : 0)
  for (const [topic, group] of byTopicFiles) {
    if (group.length < 2) continue
    const keep = [...group].sort((a, b) => rank(b.status) - rank(a.status) || b.confidence - a.confidence || Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]
    for (const p of group) {
      if (p.file === keep.file || p.pinned || toPrune.includes(p.file)) continue
      dropWrite(p.id); toPrune.push(p.file); summary.pruned.push(p.id)
      logLines.push(`dedup pref=${p.id} topic="${topic}" (trùng, giữ ${keep.id}) → xoá`)
    }
  }

  // KHÔNG có thay đổi nào → no-op tuyệt đối (không snapshot, không ghi log, không đụng active.md)
  if (!toProcess.length && !prefWrites.length && !toPrune.length && !summary.contradictions.length) {
    summary.activePrefs = countActive(prefs)
    return summary
  }

  // ── GHI (có thay đổi) ── snapshot → atomic writes → move processed → log → regen active.md
  snapshot(vaultDir, now)
  for (const e of evPersist) recordEvidence(vaultDir, e.prefId, e.kind, e.ts) // A1: bền hoá evidence → run sau vẫn đếm
  for (const p of prefWrites) writeAtomic(p.file, renderPreference(p))
  for (const f of toPrune) { try { fs.unlinkSync(f) } catch { /* mất file rồi → bỏ qua */ } }
  for (const f of toProcess) moveToProcessed(vaultDir, f)
  summary.processedSignals = toProcess.length

  // active.md = digest pref confirmed (+3 retired gần nhất). Đọc lại trạng thái sau ghi.
  const finalPrefs = readPreferences(vaultDir)
  writeAtomic(path.join(vaultDir, 'Brain', 'active.md'), renderActive(finalPrefs, now))
  summary.activePrefs = countActive(finalPrefs)

  appendLog(vaultDir, now, logLines)
  summary.changed = true
  return summary
}

function countActive(prefs: Preference[]): number {
  return prefs.filter((p) => p.status === 'unconfirmed' || p.status === 'confirmed').length
}

// ── render ──
function renderPreference(p: Preference): string {
  const fm = [
    '---', `title: ${yamlStr(p.principle.slice(0, 80))}`, 'type: preference', 'kind: brain-preference',
    `id: ${p.id}`, `topic: ${yamlStr(p.topic)}`, `sign: ${p.sign}`, `status: ${p.status}`,
    `principle: ${yamlStr(p.principle)}`, ...(p.scope ? [`scope: ${p.scope}`] : []),
    `confidence: ${p.confidence}`, `band: ${p.band}`, `applied: ${p.applied}`, `violated: ${p.violated}`,
    `evidenced_by: [${p.evidenced_by.join(', ')}]`, `created_at: ${p.created_at}`, `updated_at: ${p.updated_at}`,
    `last_evidence_at: ${p.last_evidence_at ?? 'null'}`, `pinned: ${p.pinned}`,
    'tags: [brain, preference]', `permalink: ${p.id}`, '---', '',
    `# ${p.principle}`, '',
    `- [rule] ${p.principle} #preference${p.scope ? ' #' + p.scope : ''}`,
    `- trạng thái: **${p.status}** · confidence ${p.confidence} (${p.band}) · ${p.sign} · applied ${p.applied}/violated ${p.violated}`,
    '',
  ]
  return fm.join('\n')
}

function renderActive(prefs: Preference[], now: Date): string {
  const confirmed = prefs.filter((p) => p.status === 'confirmed').sort((a, b) => b.confidence - a.confidence)
  const retired = prefs.filter((p) => p.status === 'rebutted' || p.status === 'stale' || p.status === 'expired')
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 3)
  const head = [
    '---', 'title: Brain active — digest trí nhớ', 'type: note', 'tags: [brain, active]', 'permalink: brain-active', '---', '',
    '# Trí nhớ đang hoạt động (active)', '',
    '> File này do **"dream" tự sinh — KHÔNG sửa tay.** Digest các preference đã confirmed, nạp vào đầu mỗi phiên `claude -p`.',
    `> Cập nhật: ${now.toISOString()}`, '',
  ]
  const body: string[] = []
  if (!confirmed.length) body.push('_(chưa có preference confirmed — Lucy đang theo dõi, chờ đủ tín hiệu/evidence)_', '')
  else {
    body.push('## Đã học (confirmed)', '')
    for (const p of confirmed) body.push(`- ${p.sign === 'negative' ? '⚠️' : '✅'} ${p.principle}  _(${p.band} ${p.confidence}${p.scope ? ' · ' + p.scope : ''})_`)
    body.push('')
  }
  if (retired.length) {
    body.push('## Gần đây gỡ bỏ', '')
    for (const p of retired) body.push(`- ~~${p.principle}~~ _(${p.status})_`)
    body.push('')
  }
  return [...head, ...body].join('\n')
}

// ── io an toàn ──
function writeAtomic(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, file)
}
function moveToProcessed(vaultDir: string, file: string) {
  try {
    const dest = path.join(vaultDir, 'Brain', 'inbox', 'processed')
    fs.mkdirSync(dest, { recursive: true })
    fs.renameSync(file, path.join(dest, path.basename(file)))
  } catch { /* đã move / mất file → bỏ qua */ }
}
// snapshot Brain/ vào .snapshots/<ts>/ (gitignored) trước khi sửa — rollback tay được. (Thay .tar.zst/git-commit
// vì lucy-vault nằm TRONG repo lucy → git commit ở đây sẽ commit lẫn thứ khác.)
function snapshot(vaultDir: string, now: Date) {
  try {
    const dest = path.join(vaultDir, '.snapshots', `dream-${now.toISOString().replace(/[:.]/g, '-')}`)
    fs.cpSync(path.join(vaultDir, 'Brain'), path.join(dest, 'Brain'), { recursive: true })
    pruneSnapshots(vaultDir)
  } catch { /* snapshot lỗi không chặn dream (chỉ là an toàn thêm) */ }
}
// Giữ ~SNAP_KEEP bản gần nhất trong .snapshots/ (rollback-only, không index) — chống phình
// (15k+ file). Xếp theo tên (ISO ts trong tên → sort chuỗi = sort thời gian), xoá phần dư cũ.
const SNAP_KEEP = 30
function pruneSnapshots(vaultDir: string) {
  try {
    const dir = path.join(vaultDir, '.snapshots')
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, t: fs.statSync(path.join(dir, e.name)).mtimeMs }))
      .sort((a, b) => a.t - b.t) // cũ → mới (mtime, đúng cho cả dream- lẫn consolidate-)
    for (const { name } of entries.slice(0, Math.max(0, entries.length - SNAP_KEEP))) {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true })
    }
  } catch { /* prune lỗi không chặn dream */ }
}
function appendLog(vaultDir: string, now: Date, lines: string[]) {
  if (!lines.length) return
  try {
    const dir = path.join(vaultDir, 'Brain', 'log')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, now.toISOString().slice(0, 10) + '.md')
    const block = [`\n## dream ${now.toISOString()}`, ...lines.map((l) => `- ${l}`), ''].join('\n')
    fs.appendFileSync(file, block)
  } catch { /* */ }
}

function yamlStr(v: string): string {
  const t = v.replace(/\s+/g, ' ').trim()
  return /[:#"'[\]{}]/.test(t) ? JSON.stringify(t) : t
}
