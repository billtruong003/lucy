// watcher-cli.ts - CLI chay tat ca watcher tu config/watchers.json.
// Usage: tsx src/watcher-cli.ts [--dry-run]
// Cron: */30 * * * * npx tsx src/watcher-cli.ts

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadWatchers, runWatchers } from './watcher.js'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const CONFIG = path.resolve(__dir, '../config/watchers.json')
const STATE = path.resolve(__dir, '../config/watcher-state.json')

const dryRun = process.argv.includes('--dry-run')

async function main() {
  const watchers = await loadWatchers(CONFIG)
  if (!watchers.length) { console.log("[watcher] no watchers in", CONFIG); return }

  const enabled = watchers.filter((w) => w.enabled)
  console.log("[watcher]", enabled.length + "/" + watchers.length + " enabled. dry="+dryRun)

  const results = await runWatchers(watchers, STATE, dryRun)

  let alerts = 0
  for (const r of results) {
    if (r.error) { console.warn("  ERROR", r.id, r.error); continue }
    if (!r.triggered) { console.log("  ok   ", r.id); continue }
    if (r.skippedCooldown) { console.log("  cool ", r.id, r.message); continue }
    console.log("  ALERT", r.id, r.message); alerts++
  }
  console.log("[watcher] done.", alerts, "alert(s) sent")
}

main().catch((e) => { console.error(e); process.exit(1) })
