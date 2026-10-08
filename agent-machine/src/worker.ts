// Worker — CHẠY TRÊN MÁY LOCAL (mạnh). Quay ra coordinator: claim job -> chạy claude -p -> submit.
// VPS không chạy agent; worker đến/đi tự do (máy tắt -> card xếp hàng; bật -> hút tiếp).
import path from 'node:path'
import fs from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import type { Runner } from './runner'
import type { RunResult } from './types'

// R2: project có repoUrl -> clone repo THẬT vào .worker/repos/<project>, agent sửa trong đó.
// (Không auto-push — work nằm local, bạn review/push tay. Push để dành cho stage "ship".)
const repoLocks = new Map<string, Promise<void>>() // serialize card CÙNG repo trong process này
function ensureRepoClone(root: string, repo: { url: string; branch?: string; projectId: string }): string {
  const dir = path.join(root, 'repos', repo.projectId.replace(/[^\w.-]/g, '_'))
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true })
    execFileSync('git', ['clone', repo.url, dir], { stdio: 'ignore' })
  } else {
    try { execFileSync('git', ['-C', dir, 'pull', '--ff-only'], { stdio: 'ignore' }) } catch { /* lệch -> để agent xử */ }
  }
  if (repo.branch) { try { execFileSync('git', ['-C', dir, 'checkout', repo.branch], { stdio: 'ignore' }) } catch { /* nhánh chưa có -> kệ */ } }
  // SELF-UPGRADE: clone mới KHÔNG có node_modules → reviewer build/test không chạy được. Cấp deps cho clone.
  // repoUrl là path local (vd /root/lucy) → symlink node_modules từ nguồn (NHANH, khỏi rebuild native).
  // repo remote → npm install (chậm hơn). Best-effort, không chặn clone nếu lỗi.
  try { ensureDeps(dir, fs.existsSync(repo.url) ? path.resolve(repo.url) : undefined) } catch { /* deps best-effort */ }
  return dir
}

// Tìm mọi dir có package.json (depth ≤2: monorepo Lucy = agent-machine, bridge, hub, hub/server, hub/web).
function findPkgDirs(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > 2) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (entries.some((e) => e.isFile() && e.name === 'package.json')) out.push(rel)
    for (const e of entries) if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) walk(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name, depth + 1)
  }
  walk(root, '', 0)
  return out
}

// Cấp node_modules cho clone: ưu tiên SYMLINK từ source (local) → tức thì; else npm install (best-effort).
export function ensureDeps(cloneDir: string, sourceDir?: string): void {
  for (const rel of findPkgDirs(cloneDir)) {
    const dst = path.join(cloneDir, rel, 'node_modules')
    if (fs.existsSync(dst)) continue // đã có (symlink/cài lần trước) → bỏ qua, rẻ
    const src = sourceDir ? path.join(sourceDir, rel, 'node_modules') : ''
    if (src && fs.existsSync(src)) {
      try { fs.symlinkSync(src, dst, process.platform === 'win32' ? 'junction' : 'dir'); continue } catch { /* symlink fail → thử cài */ }
    }
    try { execSync('npm install --no-audit --no-fund --loglevel=error', { cwd: path.join(cloneDir, rel), stdio: 'ignore', timeout: 300000 }) } catch { /* không cài được → reviewer sẽ báo, không nổ */ }
  }
}

const FAIL = (msg: string): RunResult => ({ outcome: { decision: 'fail', summary: msg }, cost: { usd: 0, inTok: 0, outTok: 0 }, raw: '' })

// V1: chụp "đã đổi gì" để báo cáo — repo: git status/diff; nháp: liệt kê file.
function captureArtifacts(ws: string, isRepo: boolean): { files?: string[]; diffstat?: string; isRepo?: boolean } {
  try {
    if (isRepo) {
      const status = execFileSync('git', ['-C', ws, 'status', '--porcelain'], { encoding: 'utf8' }).trim()
      const files = status ? status.split('\n').map((l) => l.slice(3).trim()).filter(Boolean).slice(0, 60) : []
      let diffstat = ''
      try { diffstat = execFileSync('git', ['-C', ws, 'diff', '--stat'], { encoding: 'utf8' }).trim().slice(0, 2000) } catch { /* */ }
      return { files, diffstat, isRepo: true }
    }
    const out: string[] = []
    const walk = (dir: string, prefix = '', depth = 0) => {
      if (depth > 2 || out.length > 60) return
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue
        const rel = prefix ? prefix + '/' + e.name : e.name
        if (e.isDirectory()) walk(path.join(dir, e.name), rel, depth + 1)
        else out.push(rel)
      }
    }
    walk(ws)
    return { files: out.slice(0, 60), isRepo: false }
  } catch { return {} }
}

// 1 bước: claim -> chạy -> submit. Trả true nếu có job đã xử lý.
export async function workerStep(coordUrl: string, runner: Runner, opts: { token?: string; localRoot?: string } = {}): Promise<boolean> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.token) headers['x-worker-token'] = opts.token

  let job: any = null
  try {
    const r = await fetch(coordUrl + '/worker/claim', { method: 'POST', headers })
    job = (await r.json()).job
  } catch { return false }
  if (!job) return false

  const root = opts.localRoot || path.join(process.cwd(), '.worker')
  const submit = async (result: RunResult) => {
    try { await fetch(coordUrl + '/worker/result', { method: 'POST', headers, body: JSON.stringify({ jobId: job.jobId, result }) }) } catch { /* coordinator tạm mất -> re-dispatch sau */ }
  }

  // workspace: repo project -> clone & serialize theo project; thường -> thư mục nháp theo card
  let ws = ''
  let release = () => {}
  if (job.repo?.url) {
    const key = job.repo.projectId
    const prev = repoLocks.get(key) || Promise.resolve()
    const lock = new Promise<void>((r) => { release = r })
    repoLocks.set(key, prev.then(() => lock).catch(() => {}))
    await prev.catch(() => {})
    try { ws = ensureRepoClone(root, job.repo) }
    catch (e) { release(); await submit(FAIL(`clone repo lỗi: ${String(e).slice(0, 160)}`)); return true }
  } else {
    ws = path.join(root, job.cardId || job.jobId) // theo CARD -> các stage cùng card chia sẻ file
    fs.mkdirSync(ws, { recursive: true })
  }

  let result: RunResult
  try { result = await runner.run(job.card, job.stage, job.persona, ws) }
  catch (e) { result = FAIL(`worker lỗi: ${String(e).slice(0, 200)}`) }
  finally { release() }
  try { result.artifacts = captureArtifacts(ws, !!job.repo?.url) } catch { /* */ }
  await submit(result)
  return true
}

// Vòng worker: poll coordinator (dial-out). concurrency = số claude -p CHẠY SONG SONG tối đa
// trên MÁY NÀY (vd VPS cap 2, local cap nhiều hơn). stopWhenIdle=true cho test.
export async function runWorker(coordUrl: string, runner: Runner, opts: { token?: string; pollMs?: number; localRoot?: string; stopWhenIdle?: boolean; concurrency?: number } = {}) {
  const pollMs = opts.pollMs ?? 500
  const concurrency = Math.max(1, opts.concurrency ?? 1)
  const lane = async () => {
    for (;;) {
      const did = await workerStep(coordUrl, runner, opts)
      if (!did) {
        if (opts.stopWhenIdle) return
        await new Promise((s) => setTimeout(s, pollMs))
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => lane()))
}
