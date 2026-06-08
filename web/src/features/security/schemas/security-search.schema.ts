import type { LoginEventStatus } from '../services/security-audit.service'

export type SecurityTab = 'sessions' | 'login-events'

export type SecuritySearch = {
  tab?: SecurityTab
  page?: number
  search?: string
  status?: LoginEventStatus
}

const validTabs: SecurityTab[] = ['sessions', 'login-events']
const validStatuses: LoginEventStatus[] = ['success', 'failure']

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

export function parseSecuritySearch(
  search: Record<string, unknown>,
): SecuritySearch {
  const tab =
    typeof search.tab === 'string' &&
    validTabs.includes(search.tab as SecurityTab)
      ? (search.tab as SecurityTab)
      : undefined
  const page = parsePage(search.page)
  const term =
    typeof search.search === 'string' && search.search.trim()
      ? search.search.trim()
      : undefined
  const status =
    typeof search.status === 'string' &&
    validStatuses.includes(search.status as LoginEventStatus)
      ? (search.status as LoginEventStatus)
      : undefined

  return {
    ...(tab ? { tab } : {}),
    ...(page ? { page } : {}),
    ...(term ? { search: term } : {}),
    ...(status ? { status } : {}),
  }
}
