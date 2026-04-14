import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { sessionOptions } from '../services/auth-session.queries'

const protectedRouteApi = getRouteApi('/_protected')

export function useSession() {
  const routeContext = protectedRouteApi.useRouteContext()
  const query = useQuery({
    ...sessionOptions(),
    initialData: {
      session: routeContext.session,
      user: routeContext.user,
      permissions: routeContext.permissions,
    },
  })

  return {
    session: query.data?.session ?? routeContext.session,
    user: query.data?.user ?? routeContext.user,
    permissions: query.data?.permissions ?? routeContext.permissions,
    isRefetching: query.isRefetching,
  }
}
