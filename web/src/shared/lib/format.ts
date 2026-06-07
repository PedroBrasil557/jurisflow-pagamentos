export function formatDateTime(value: string | Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function formatBytes(sizeInBytes: number) {
  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`
  }

  if (sizeInBytes < 1024 * 1024) {
    return `${(sizeInBytes / 1024).toFixed(1)} KB`
  }

  return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDateTimeMedium(value: string | Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

// Converte string ISO "YYYY-MM-DD" para Date (meia-noite local).
export function isoToDate(value?: string): Date | undefined {
  if (!value) {
    return undefined
  }

  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

// Converte Date para string ISO "YYYY-MM-DD" no fuso local.
export function dateToIso(value?: Date): string | undefined {
  if (!value) {
    return undefined
  }

  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

// Formata uma data (Date ou ISO "YYYY-MM-DD") como "dd/mm/aaaa".
export function formatShortDate(value: Date | string): string {
  const date = typeof value === 'string' ? isoToDate(value) : value

  if (!date) {
    return ''
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}
