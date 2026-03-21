function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')

  if (lastDot === -1 || lastDot === 0) {
    return ''
  }

  return fileName.slice(lastDot)
}

export function buildChecklistDownloadFileName(input: {
  documentTypeSortOrder: number
  documentTypeLabel: string
  processCode: string
  processFullName: string
  originalFileName: string
}): string {
  const sortPrefix = String(input.documentTypeSortOrder).padStart(2, '0')
  const ext = getFileExtension(input.originalFileName)

  return `${sortPrefix}. ${input.documentTypeLabel} - ${input.processCode} - ${input.processFullName}${ext}`
}

export function buildBatchDownloadFileName(input: {
  processCode: string
  processFullName: string
  originalFileName: string
}): string {
  return `${input.processCode} - ${input.processFullName} - ${input.originalFileName}`
}
