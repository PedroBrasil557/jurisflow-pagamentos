export async function downloadFile(url: string, fileName: string) {
  try {
    // Try fetch + blob approach (works for same-origin or CORS-enabled URLs)
    const response = await fetch(url)
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = objectUrl
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(objectUrl)
  } catch {
    // Fallback: direct link (cross-origin, browser may not use fileName)
    const link = document.createElement('a')

    link.href = url
    link.download = fileName
    link.rel = 'noopener noreferrer'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }
}
