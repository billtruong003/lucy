// S1/U0 — "reduce effects" toggle (a11y/perf escape hatch).
// Bật → thêm class .reduce-fx lên <html>: tắt animation/transition, glass→nền đặc,
// gỡ backdrop-blur (nhẹ GPU client yếu). Mặc định OFF; OS prefers-reduced-* vẫn
// luôn được tôn trọng độc lập qua media-query trong index.css.

const KEY = 'lucy.reduceFx'

export function getReduceFx(): boolean {
  return localStorage.getItem(KEY) === '1'
}

export function applyReduceFx(on: boolean) {
  document.documentElement.classList.toggle('reduce-fx', on)
}

export function setReduceFx(on: boolean) {
  localStorage.setItem(KEY, on ? '1' : '0')
  applyReduceFx(on)
}

// gọi 1 lần lúc boot (trước render) để tránh nháy hiệu ứng.
export function initFx() {
  applyReduceFx(getReduceFx())
}
