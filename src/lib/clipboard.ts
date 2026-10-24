/** Copies text, falling back to execCommand where the Clipboard API is unavailable (plain http on the LAN). */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // Not a secure context, or permission denied.
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  area.remove()
}
