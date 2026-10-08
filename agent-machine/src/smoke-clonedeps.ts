// smoke-clonedeps — verify ensureDeps: clone mới tự có node_modules (symlink từ source) →
// reviewer build/typecheck được trong clone. Đây là mảnh thiếu cho self-upgrade trên VPS.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { ensureDeps } from './worker'

const REPO = path.resolve(process.cwd(), '..') // = LUCY repo (chạy từ agent-machine)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-clone-'))
const clone = path.join(tmp, 'clone')
const PKG_DIRS = ['agent-machine', 'bridge', 'hub', 'hub/server', 'hub/web']

function cleanup(): void {
  // AN TOÀN: gỡ symlink node_modules TRƯỚC khi xoá tmp → không bao giờ follow junction vào source thật.
  for (const rel of PKG_DIRS) {
    const p = path.join(clone, rel, 'node_modules')
    try { if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p) } catch { /* không phải symlink/không có */ }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* */ }
}

try {
  console.log(`▶ clone repo Lucy (local) → ${clone}`)
  execSync(`git clone --quiet "${REPO}" "${clone}"`, { stdio: 'ignore', timeout: 120000 })

  const before = fs.existsSync(path.join(clone, 'agent-machine', 'node_modules'))
  console.log(`  clone mới có agent-machine/node_modules? ${before} (kỳ vọng false)`)

  const t0 = Date.now()
  ensureDeps(clone, REPO) // source = repo local → symlink
  console.log(`  ensureDeps xong ${(Date.now() - t0) / 1000}s`)

  const nm = path.join(clone, 'agent-machine', 'node_modules')
  const linked = fs.existsSync(nm)
  const isLink = (() => { try { return fs.lstatSync(nm).isSymbolicLink() } catch { return false } })()
  const tscThere = fs.existsSync(path.join(nm, 'typescript'))
  console.log(`  agent-machine/node_modules: tồn tại=${linked} symlink=${isLink} typescript-resolvable=${tscThere}`)

  let tc = 'FAIL'
  try { execSync('npm run typecheck', { cwd: path.join(clone, 'agent-machine'), stdio: 'pipe', timeout: 180000 }); tc = 'PASS' }
  catch (e) { tc = 'FAIL: ' + String((e as { stdout?: Buffer })?.stdout || e).slice(0, 300) }
  console.log(`  typecheck TRONG CLONE: ${tc}`)

  // chứng minh source KHÔNG bị xoá khi cleanup (an toàn)
  const ok = linked && tscThere && tc === 'PASS'
  cleanup()
  const srcSafe = fs.existsSync(path.join(REPO, 'agent-machine', 'node_modules', 'typescript'))
  console.log(`  source node_modules còn nguyên sau cleanup? ${srcSafe} (PHẢI true)`)
  console.log(ok && srcSafe ? '✅ PASS — clone tự có deps + build được + cleanup an toàn' : '❌ FAIL')
  process.exit(ok && srcSafe ? 0 : 1)
} catch (e) {
  console.error('lỗi:', e)
  cleanup()
  process.exit(1)
}
