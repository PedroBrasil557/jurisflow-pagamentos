import { queryOptions } from '@tanstack/react-query'
import {
  fetchProfileDetail,
  fetchProfiles,
  fetchUserHousingComplexes,
  type ProfileListQuery,
} from './permissions.service'

export const profileKeys = {
  all: ['profiles'] as const,
  lists: () => [...profileKeys.all, 'list'] as const,
  list: (query: ProfileListQuery) => [...profileKeys.lists(), query] as const,
  details: () => [...profileKeys.all, 'detail'] as const,
  detail: (id: string) => [...profileKeys.details(), id] as const,
  userHousingComplexes: (userId: string) =>
    [...profileKeys.all, 'user-housing-complexes', userId] as const,
}

export function profileListOptions(query: ProfileListQuery) {
  return queryOptions({
    queryKey: profileKeys.list(query),
    queryFn: () => fetchProfiles(query),
  })
}

export function profileDetailOptions(profileId: string) {
  return queryOptions({
    queryKey: profileKeys.detail(profileId),
    queryFn: () => fetchProfileDetail(profileId),
    enabled: !!profileId,
  })
}

export function userHousingComplexesOptions(userId: string) {
  return queryOptions({
    queryKey: profileKeys.userHousingComplexes(userId),
    queryFn: () => fetchUserHousingComplexes(userId),
    enabled: !!userId,
  })
}
