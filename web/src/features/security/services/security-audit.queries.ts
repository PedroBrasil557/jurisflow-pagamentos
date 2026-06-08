import { queryOptions } from '@tanstack/react-query'
import {
  type ActiveSessionsQuery,
  fetchActiveSessions,
  fetchLoginEvents,
  type LoginEventsQuery,
} from './security-audit.service'

export const securityKeys = {
  all: ['security'] as const,
  loginEventsLists: () => [...securityKeys.all, 'login-events'] as const,
  loginEvents: (query: LoginEventsQuery) =>
    [...securityKeys.loginEventsLists(), query] as const,
  sessionsLists: () => [...securityKeys.all, 'sessions'] as const,
  sessions: (query: ActiveSessionsQuery) =>
    [...securityKeys.sessionsLists(), query] as const,
}

export function loginEventsOptions(query: LoginEventsQuery) {
  return queryOptions({
    queryKey: securityKeys.loginEvents(query),
    queryFn: () => fetchLoginEvents(query),
  })
}

export function activeSessionsOptions(query: ActiveSessionsQuery) {
  return queryOptions({
    queryKey: securityKeys.sessions(query),
    queryFn: () => fetchActiveSessions(query),
  })
}
