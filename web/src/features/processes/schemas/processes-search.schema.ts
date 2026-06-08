import {
  ownerTypeLabels,
  type OwnerTypeValue,
  processStatusLabels,
  type ProcessStatusValue,
} from '../services/processes.service'

export type ProcessesSearch = {
  page?: number
  search?: string
  statuses?: ProcessStatusValue[]
  ownerTypes?: OwnerTypeValue[]
  housingComplexIds?: string[]
  createdFrom?: string
  createdTo?: string
}

function parsePage(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed >= 1) {
      return parsed
    }
  }

  return undefined
}

function parseSearch(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  return undefined
}

function parseStatuses(value: unknown): ProcessStatusValue[] | undefined {
  const raw = Array.isArray(value) ? value : value != null ? [value] : []
  const valid = raw.filter(
    (item): item is ProcessStatusValue =>
      typeof item === 'string' && item in processStatusLabels,
  )

  return valid.length > 0 ? valid : undefined
}

function parseOwnerTypes(value: unknown): OwnerTypeValue[] | undefined {
  const raw = Array.isArray(value) ? value : value != null ? [value] : []
  const valid = raw.filter(
    (item): item is OwnerTypeValue =>
      typeof item === 'string' && item in ownerTypeLabels,
  )

  return valid.length > 0 ? valid : undefined
}

function parseHousingComplexIds(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : value != null ? [value] : []
  const valid = raw.filter(
    (item): item is string => typeof item === 'string' && item.trim() !== '',
  )

  return valid.length > 0 ? valid : undefined
}

// Aceita apenas datas no formato ISO "YYYY-MM-DD".
function parseIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined
  }

  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? undefined : value
}

export function parseProcessesSearch(
  search: Record<string, unknown>,
): ProcessesSearch {
  const page = parsePage(search.page)
  const term = parseSearch(search.search)
  const statuses = parseStatuses(search.statuses)
  const ownerTypes = parseOwnerTypes(search.ownerTypes)
  const housingComplexIds = parseHousingComplexIds(search.housingComplexIds)
  const createdFrom = parseIsoDate(search.createdFrom)
  const createdTo = parseIsoDate(search.createdTo)

  return {
    ...(page ? { page } : {}),
    ...(term ? { search: term } : {}),
    ...(statuses ? { statuses } : {}),
    ...(ownerTypes ? { ownerTypes } : {}),
    ...(housingComplexIds ? { housingComplexIds } : {}),
    ...(createdFrom ? { createdFrom } : {}),
    ...(createdTo ? { createdTo } : {}),
  }
}
