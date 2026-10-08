// smoke-catalog (F4) — kiểm NGUỒN DUY NHẤT của catalog model:
//  1) toàn vẹn: FALLBACKS + ROUTE_TABLE chỉ trỏ key có trong MODEL_CATALOG (chống "khai 2 nơi" lệch nhau)
//  2) gen-catalog sinh ra JSON đúng shape (models/providers/fallbacks/routeTable)
//  3) file config/model-catalog.json (nếu đã gen) khớp nguồn TS hiện tại
import fs from 'node:fs'
import { MODEL_CATALOG, FALLBACKS } from './llm-lane'
import { ROUTE_TABLE } from './chat-lane'
import { buildCatalog, validateCatalogIntegrity, CATALOG_PATH } from './gen-catalog'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✅ ' + m) } else { fail++; console.log('  ❌ ' + m) } }

console.log('T1 — toàn vẹn nguồn (key trong FALLBACKS/ROUTE_TABLE ⊆ MODEL_CATALOG)')
const errs = validateCatalogIntegrity()
if (errs.length) errs.forEach((e) => console.log('     ↳ ' + e))
ok(errs.length === 0, `không có key lạ (${errs.length} lỗi)`)

console.log('T2 — buildCatalog() shape')
const cat = buildCatalog()
ok(Array.isArray(cat.models) && cat.models.length === MODEL_CATALOG.length, `models = ${cat.models.length} (= MODEL_CATALOG ${MODEL_CATALOG.length})`)
ok(!!cat.providers && Object.keys(cat.providers).length > 0, `providers = ${Object.keys(cat.providers).length}`)
ok(JSON.stringify(cat.fallbacks) === JSON.stringify(FALLBACKS), 'fallbacks khớp nguồn')
ok(JSON.stringify(cat.routeTable) === JSON.stringify(ROUTE_TABLE), 'routeTable khớp nguồn')
ok(Object.values(cat.providers).every((p: any) => !('envKey' in p)), 'providers KHÔNG lộ envKey')
ok(cat.models.every((m: any) => m.key && m.provider && m.model && m.role), 'mọi model có key/provider/model/role')

console.log('T3 — file đã-gen (nếu có) khớp nguồn TS')
if (fs.existsSync(CATALOG_PATH)) {
  const onDisk = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))
  ok(JSON.stringify(onDisk.models) === JSON.stringify(cat.models), 'model-catalog.json khớp MODEL_CATALOG (chạy `npm run gen:catalog` nếu lệch)')
} else {
  console.log('  ⏭ chưa gen config/model-catalog.json (chạy `npm run gen:catalog`) — bỏ qua')
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
