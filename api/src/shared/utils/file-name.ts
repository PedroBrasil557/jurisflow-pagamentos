function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')

  if (lastDot === -1 || lastDot === 0) {
    return ''
  }

  return fileName.slice(lastDot)
}

export function buildChecklistDownloadFileName(input: {
  documentNumber: string | null
  documentTypeLabel: string
  processCode: string
  processFullName: string
  originalFileName: string
}): string {
  const prefix = input.documentNumber ? `${input.documentNumber}. ` : ''
  const ext = getFileExtension(input.originalFileName)

  return `${prefix}${input.documentTypeLabel} - ${input.processCode} - ${input.processFullName}${ext}`
}

export function buildBatchDownloadFileName(input: {
  processCode: string
  processFullName: string
  originalFileName: string
}): string {
  return `${input.processCode} - ${input.processFullName} - ${input.originalFileName}`
}
