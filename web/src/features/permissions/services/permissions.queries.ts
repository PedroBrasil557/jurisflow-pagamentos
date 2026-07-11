import { queryOptions } from '@tanstack/react-query'
import {
  fetchProfileDetail,
  fetchProfiles,
  fetchTitularLocalidades,
  fetchUserHousingComplexes,
  fetchUserTitularMunicipios,
  fetchUserTitularUfs,
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
  userTitularUfs: (userId: string) =>
    [...profileKeys.all, 'user-titular-ufs', userId] as const,
  userTitularMunicipios: (userId: string) =>
    [...profileKeys.all, 'user-titular-municipios', userId] as const,
  titularLocalidades: () =>
    [...profileKeys.all, 'titular-localidades'] as const,
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

export function userTitularUfsOptions(userId: string) {
  return queryOptions({
    queryKey: profileKeys.userTitularUfs(userId),
    queryFn: () => fetchUserTitularUfs(userId),
    enabled: !!userId,
  })
}

export function userTitularMunicipiosOptions(userId: string) {
  return queryOptions({
    queryKey: profileKeys.userTitularMunicipios(userId),
    queryFn: () => fetchUserTitularMunicipios(userId),
    enabled: !!userId,
  })
}

export function titularLocalidadesOptions() {
  return queryOptions({
    queryKey: profileKeys.titularLocalidades(),
    queryFn: fetchTitularLocalidades,
    staleTime: 5 * 60 * 1000,
  })
}
