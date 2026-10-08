export type ToastVariant = 'success' | 'error' | 'info'

function getContainer(): HTMLElement {
  let c = document.getElementById('lucy-toast-container')
  if (!c) {
    c = document.createElement('div')
    c.id = 'lucy-toast-container'
    // Layout + z-index are defined in CSS (#lucy-toast-container)
    c.style.pointerEvents = 'none'
    document.body.appendChild(c)
  }
  return c
}

export function showToast(message: string, variant: ToastVariant = 'info', duration = 2500) {
  const el = document.createElement('div')
  el.className = `toast toast-${variant}`
  el.textContent = message
  getContainer().appendChild(el)

  // two rAF to allow transition to start from initial state
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('toast-in')))

  setTimeout(() => {
    el.classList.add('toast-exit')
    el.classList.remove('toast-in')
    el.addEventListener('transitionend', () => el.remove(), { once: true })
  }, duration)
}
