// Config loader — nạp personas + pipelines từ FILE (config-là-DATA = cửa extend).
// Lucy tự ghi file vào config/ -> hệ tự mở rộng, KHÔNG sửa engine.
import fs from 'node:fs'
import path from 'node:path'
import type { Store } from './store'
import type { Persona, Pipeline } from './types'

export function loadConfig(store: Store, configDir: string): { personas: number; pipelines: number } {
  let personas = 0
  let pipelines = 0
  for (const f of listJson(path.join(configDir, 'personas'))) {
    try {
      const p = JSON.parse(fs.readFileSync(f, 'utf8')) as Persona
      if (p.id && p.systemPrompt && p.model) { store.registerPersona(p); personas++ }
    } catch { /* skip file lỗi */ }
  }
  for (const f of listJson(path.join(configDir, 'pipelines'))) {
    try {
      const pl = JSON.parse(fs.readFileSync(f, 'utf8')) as Pipeline
      if (pl.id && Array.isArray(pl.stages) && pl.stages.length) { store.registerPipeline(pl); pipelines++ }
    } catch { /* skip */ }
  }
  return { personas, pipelines }
}

function listJson(dir: string): string[] {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)) } catch { return [] }
}
