// DASH-FIX S5: mốc "ngày/tháng" theo giờ VN (UTC+7) — NGUỒN DUY NHẤT cho token-guard, metrics, coordinator.
// Trước đây mỗi nơi tự cắt ngày bằng toISOString() (UTC) → mốc "hôm nay" lệch ~7h quanh nửa đêm,
// token-guard.resetDay ↔ metrics date có thể rơi vào 2 ngày khác nhau. Dùng chung helper này để khớp.

// Offset giờ "ngày" — mặc định VN (UTC+7); đọc env LUCY_TZ_OFFSET (đã có trong env coordinator) nếu set.
const TZ_OFFSET_H = Number(process.env.LUCY_TZ_OFFSET) || 7
const VN_OFFSET_MS = TZ_OFFSET_H * 3600_000

/** YYYY-MM-DD theo giờ VN (UTC+7). ts mặc định = now. */
export function vnDay(ts: number = Date.now()): string {
  return new Date(ts + VN_OFFSET_MS).toISOString().slice(0, 10)
}

/** YYYY-MM theo giờ VN. */
export function vnMonth(ts: number = Date.now()): string {
  return vnDay(ts).slice(0, 7)
}

/** Mốc bắt đầu bucket (ms UTC) căn theo nửa đêm VN. span=DAY_MS → midnight VN; span=HOUR_MS → giữ nguyên (7h chia hết giờ). */
export function vnAlign(t: number, span: number): number {
  return Math.floor((t + VN_OFFSET_MS) / span) * span - VN_OFFSET_MS
}
