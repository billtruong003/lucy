// U2 — cầu nối "xem trong tinh hà": Memory (hoặc nơi khác) yêu cầu focus 1 note theo path
// → App nhảy sang tab Neural · NeuralTab bật mode galaxy · Galaxy ngắm + pulse node đó.
// Pub-sub nhẹ (không thêm lib), nhiều listener (App + NeuralTab + Galaxy) cùng nghe.
type Listener = (path: string) => void
const listeners = new Set<Listener>()

export function focusInGalaxy(path: string) {
  if (!path) return
  for (const l of listeners) { try { l(path) } catch { /* */ } }
}
// U2 — chỉ MỞ tab Tinh hà (không ngắm node cụ thể). Listener App + NeuralTab bỏ qua path.
export function openGalaxyTab() {
  for (const l of listeners) { try { l('') } catch { /* */ } }
}
export function onGalaxyFocus(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
