// K4 — persona registry CRUD: ghi/xoá persona ra FILE config/personas/<id>.json (config-là-DATA).
// Lucy/Bill quản expert qua Hub thay vì sửa JSON tay. FS-confined (chỉ trong personas dir, chống path-escape).
import fs from 'node:fs'
import path from 'node:path'
import type { Persona } from './types'

export function personasDir(configDir: string): string { return path.join(configDir, 'personas') }

// id an toàn để làm tên file (chống ../ và ký tự lạ)
export function validPersonaId(id: string): boolean { return /^[a-z0-9][a-z0-9_-]{0,48}$/i.test(id) }

const TOOL_WHITELIST = new Set(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'])

// Dựng Persona SẠCH từ input tùy ý (Hub gửi) — chỉ giữ field hợp lệ, ép kiểu, chặn rác.
// Trả null nếu thiếu field bắt buộc (id/name/systemPrompt).
export function sanitizePersona(input: any): Persona | null {
  if (!input || typeof input !== 'object') return null
  const id = String(input.id || '').trim()
  const name = String(input.name || '').trim()
  const systemPrompt = String(input.systemPrompt || '').trim()
  if (!id || !validPersonaId(id) || !name || !systemPrompt) return null
  const model: Persona['model'] = input.model === 'opus' ? 'opus' : 'sonnet'
  const kind = ['orchestrator', 'specialist', 'executor'].includes(input.kind) ? input.kind : 'specialist'
  const tags = Array.isArray(input.tags) ? input.tags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 16) : []
  const allowedTools: string[] | undefined = Array.isArray(input.allowedTools)
    ? [...new Set(input.allowedTools.map((t: any) => String(t).trim()).filter((t: string) => TOOL_WHITELIST.has(t)) as string[])]
    : undefined
  const p: Persona = { id, name, systemPrompt, model, kind, tags }
  if (input.avatar) p.avatar = String(input.avatar).slice(0, 512)
  if (input.realm) p.realm = String(input.realm).slice(0, 120)
  if (input.laneModel) p.laneModel = String(input.laneModel).trim().slice(0, 120)
  if (allowedTools && allowedTools.length) p.allowedTools = allowedTools
  const maxTurns = Number(input.maxTurns); if (Number.isFinite(maxTurns) && maxTurns > 0) p.maxTurns = Math.min(64, Math.round(maxTurns))
  const timeoutSec = Number(input.timeoutSec); if (Number.isFinite(timeoutSec) && timeoutSec > 0) p.timeoutSec = Math.min(1800, Math.round(timeoutSec))
  return p
}

function safeFile(configDir: string, id: string): string | null {
  if (!validPersonaId(id)) return null
  const dir = path.resolve(personasDir(configDir))
  const file = path.resolve(path.join(dir, id + '.json'))
  return file.startsWith(dir + path.sep) ? file : null
}

// atomic: ghi tmp rồi rename (crash giữa chừng không hỏng file)
export function writePersonaFile(configDir: string, p: Persona): boolean {
  const file = safeFile(configDir, p.id)
  if (!file) return false
  fs.mkdirSync(personasDir(configDir), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2))
  fs.renameSync(tmp, file)
  return true
}

export function deletePersonaFile(configDir: string, id: string): boolean {
  const file = safeFile(configDir, id)
  if (!file || !fs.existsSync(file)) return false
  fs.rmSync(file)
  return true
}
