export async function copyToClipboard(text: string): Promise<void> {
  if (window.mainApi) {
    await window.mainApi.writeClipboard(text)
  } else if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
  } else {
    fallbackCopy(text)
  }
}

function fallbackCopy(text: string): void {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!copied) throw new Error('copy failed')
}
