// Copy chịu được HTTP (non-secure context): navigator.clipboard undefined trên http://IP
// → fallback textarea + execCommand. Dùng chung Prompts.tsx + PromptCompare.tsx.
export function copyText(text: string): boolean {
  try {
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text); return true }
  } catch { /* fallthrough */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.focus(); ta.select()
    const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok
  } catch { return false }
}
