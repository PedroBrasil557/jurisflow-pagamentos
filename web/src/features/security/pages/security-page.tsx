import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Activity, Loader2, LogIn, ShieldOff } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { AppDialog } from '@/shared/components/app-dialog'
import { PageHeader } from '@/shared/components/page-header'
import { SearchInput } from '@/shared/components/search-input'
import { SettingsLayout } from '@/shared/components/settings-layout'
import { StatusBadge } from '@/shared/components/status-badge'
import {
  DataTable,
  type DataTableColumn,
} from '@/shared/components/ui/data-table'
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value'
import { formatDateTime } from '@/shared/lib/format'
import type {
  SecuritySearch,
  SecurityTab,
} from '../schemas/security-search.schema'
import { useRevokeSession } from '../services/security-audit.mutations'
import {
  activeSessionsOptions,
  loginEventsOptions,
} from '../services/security-audit.queries'
import {
  type ActiveSessionListItem,
  defaultSecurityPageLimit,
  formatLocation,
  type LoginEventListItem,
  type LoginEventStatus,
  loginStatusLabels,
  loginStatusOptions,
} from '../services/security-audit.service'

type SecurityPageProps = {
  currentTab: SecurityTab
  currentPage: number
  currentSearch: string
  currentStatus?: LoginEventStatus
}

function LocationCell({
  city,
  region,
  country,
}: {
  city?: string | null
  region?: string | null
  country?: string | null
}) {
  const location = formatLocation({ city, region, country })

  return location ? (
    <span className="text-sm text-foreground">{location}</span>
  ) : (
    <span className="text-xs text-muted-foreground">Nao identificada</span>
  )
}

function DeviceCell({ userAgent }: { userAgent?: string | null }) {
  return userAgent ? (
    <span
      className="block max-w-[18rem] truncate text-xs text-muted-foreground"
      title={userAgent}
    >
      {userAgent}
    </span>
  ) : (
    <span className="text-xs text-muted-foreground">Desconhecido</span>
  )
}

export function SecurityPage({
  currentTab,
  currentPage,
  currentSearch,
  currentStatus,
}: SecurityPageProps) {
  const navigate = useNavigate()
  const [search, setSearch] = useState(currentSearch)
  const debouncedSearch = useDebouncedValue(search)
  const [revokeTarget, setRevokeTarget] =
    useState<ActiveSessionListItem | null>(null)
  const revokeMutation = useRevokeSession()

  const sessionsQuery = useQuery({
    ...activeSessionsOptions({
      limit: defaultSecurityPageLimit,
      page: currentPage,
      search: debouncedSearch,
    }),
    enabled: currentTab === 'sessions',
  })

  const eventsQuery = useQuery({
    ...loginEventsOptions({
      limit: defaultSecurityPageLimit,
      page: currentPage,
      search: debouncedSearch,
      status: currentStatus,
    }),
    enabled: currentTab === 'login-events',
  })

  function pushSearch(overrides: Partial<SecuritySearch>) {
    const merged: SecuritySearch = {
      tab: currentTab,
      page: currentPage,
      ...(currentSearch ? { search: currentSearch } : {}),
      ...(currentStatus ? { status: currentStatus } : {}),
      ...overrides,
    }

    const next: SecuritySearch = { tab: merged.tab, page: merged.page ?? 1 }
    if (merged.search) next.search = merged.search
    if (merged.tab === 'login-events' && merged.status) {
      next.status = merged.status
    }

    void navigate({ to: '/seguranca', search: next })
  }

  function handleTabChange(tab: SecurityTab) {
    if (tab === currentTab) {
      return
    }
    setSearch('')
    void navigate({ to: '/seguranca', search: { tab } })
  }

  function handleSearchChange(value: string) {
    setSearch(value)
    if (value !== currentSearch) {
      void navigate({
        replace: true,
        to: '/seguranca',
        search: {
          tab: currentTab,
          page: 1,
          ...(value ? { search: value } : {}),
          ...(currentTab === 'login-events' && currentStatus
            ? { status: currentStatus }
            : {}),
        },
      })
    }
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget) {
      return
    }

    try {
      await revokeMutation.mutateAsync(revokeTarget.id)
      toast.success('Sessao revogada com sucesso.')
      setRevokeTarget(null)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel revogar a sessao.',
      )
    }
  }

  const sessionColumns: readonly DataTableColumn<ActiveSessionListItem>[] = [
    {
      id: 'user',
      header: 'Usuario',
      render: (item) => (
        <div className="grid gap-1">
          <p className="font-medium text-foreground">{item.userName}</p>
          <p className="text-sm text-muted-foreground">{item.userEmail}</p>
        </div>
      ),
    },
    {
      id: 'ip',
      header: 'IP / Localidade',
      render: (item) => (
        <div className="grid gap-1">
          <span className="text-sm text-foreground">
            {item.ipAddress || 'Nao informado'}
          </span>
          <LocationCell
            city={item.city}
            country={item.country}
            region={item.region}
          />
        </div>
      ),
    },
    {
      id: 'device',
      header: 'Dispositivo',
      render: (item) => <DeviceCell userAgent={item.userAgent} />,
    },
    {
      id: 'createdAt',
      header: 'Inicio',
      render: (item) => (
        <span className="text-sm text-muted-foreground">
          {formatDateTime(item.createdAt)}
        </span>
      ),
    },
    {
      id: 'expiresAt',
      header: 'Expira em',
      render: (item) => (
        <span className="text-sm text-muted-foreground">
          {formatDateTime(item.expiresAt)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Acoes',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (item) => (
        <Button
          onClick={() => setRevokeTarget(item)}
          size="sm"
          type="button"
          variant="outline"
        >
          <ShieldOff className="size-4" />
          Revogar
        </Button>
      ),
    },
  ]

  const eventColumns: readonly DataTableColumn<LoginEventListItem>[] = [
    {
      id: 'user',
      header: 'Usuario',
      render: (item) => (
        <div className="grid gap-1">
          <p className="font-medium text-foreground">
            {item.userName ?? 'Nao identificado'}
          </p>
          <p className="text-sm text-muted-foreground">{item.identifier}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Resultado',
      render: (item) => (
        <div className="grid gap-1">
          <StatusBadge tone={item.status === 'success' ? 'success' : 'error'}>
            {loginStatusLabels[item.status as LoginEventStatus]}
          </StatusBadge>
          {item.failureReason ? (
            <span className="text-xs text-muted-foreground">
              {item.failureReason}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'ip',
      header: 'IP / Localidade',
      render: (item) => (
        <div className="grid gap-1">
          <span className="text-sm text-foreground">
            {item.ipAddress || 'Nao informado'}
          </span>
          <LocationCell
            city={item.city}
            country={item.country}
            region={item.region}
          />
        </div>
      ),
    },
    {
      id: 'device',
      header: 'Dispositivo',
      render: (item) => <DeviceCell userAgent={item.userAgent} />,
    },
    {
      id: 'createdAt',
      header: 'Data',
      render: (item) => (
        <span className="text-sm text-muted-foreground">
          {formatDateTime(item.createdAt)}
        </span>
      ),
    },
  ]

  const isSessions = currentTab === 'sessions'
  const activeQuery = isSessions ? sessionsQuery : eventsQuery
  const data = activeQuery.data

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Seguranca"
        description="Acompanhe logins, sessoes ativas e acessos da plataforma."
      />

      <SettingsLayout
        items={[
          {
            icon: Activity,
            isActive: isSessions,
            label: 'Sessoes ativas',
            onClick: () => handleTabChange('sessions'),
          },
          {
            icon: LogIn,
            isActive: currentTab === 'login-events',
            label: 'Historico de logins',
            onClick: () => handleTabChange('login-events'),
          },
        ]}
      >
        <div className="grid gap-4">
          <SearchInput
            containerClassName="w-full sm:max-w-sm"
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={
              isSessions
                ? 'Buscar por usuario ou e-mail...'
                : 'Buscar por usuario ou identificador...'
            }
            value={search}
          />

          {!isSessions ? (
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => pushSearch({ status: undefined, page: 1 })}
                size="sm"
                type="button"
                variant={currentStatus ? 'outline' : 'default'}
              >
                Todos
              </Button>
              {loginStatusOptions.map((option) => (
                <Button
                  key={option.value}
                  onClick={() => pushSearch({ status: option.value, page: 1 })}
                  size="sm"
                  type="button"
                  variant={
                    currentStatus === option.value ? 'default' : 'outline'
                  }
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {activeQuery.isFetching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            <span>{data?.total ?? 0} registro(s)</span>
          </div>

          <Card className="overflow-hidden">
            <CardContent className="overflow-x-auto px-0 sm:px-0">
              {isSessions ? (
                <DataTable
                  ariaLabel="Tabela de sessoes ativas"
                  columns={sessionColumns}
                  emptyState={
                    <div className="rounded-[1.75rem] border border-dashed border-border bg-muted/25 px-6 py-10 text-center">
                      <p className="text-sm font-medium text-muted-foreground">
                        Nenhuma sessao ativa encontrada
                      </p>
                    </div>
                  }
                  getItemKey={(item) => item.id}
                  items={sessionsQuery.data?.items ?? []}
                  pagination={{
                    itemLabel: 'sessoes',
                    onPageChange: (nextPage) => pushSearch({ page: nextPage }),
                    page: currentPage,
                    pageSize:
                      sessionsQuery.data?.pageSize ?? defaultSecurityPageLimit,
                    total: sessionsQuery.data?.total ?? 0,
                  }}
                  renderMobileCard={(item) => (
                    <article className="grid gap-3 rounded-3xl border border-border bg-card p-5 shadow-sm">
                      <div>
                        <p className="font-medium text-foreground">
                          {item.userName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {item.userEmail}
                        </p>
                      </div>
                      <div className="grid gap-1">
                        <span className="text-sm text-foreground">
                          {item.ipAddress || 'IP nao informado'}
                        </span>
                        <LocationCell
                          city={item.city}
                          country={item.country}
                          region={item.region}
                        />
                        <DeviceCell userAgent={item.userAgent} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Inicio: {formatDateTime(item.createdAt)} · Expira:{' '}
                        {formatDateTime(item.expiresAt)}
                      </p>
                      <Button
                        className="w-full"
                        onClick={() => setRevokeTarget(item)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <ShieldOff className="size-4" />
                        Revogar
                      </Button>
                    </article>
                  )}
                />
              ) : (
                <DataTable
                  ariaLabel="Tabela de historico de logins"
                  columns={eventColumns}
                  emptyState={
                    <div className="rounded-[1.75rem] border border-dashed border-border bg-muted/25 px-6 py-10 text-center">
                      <p className="text-sm font-medium text-muted-foreground">
                        Nenhum login registrado
                      </p>
                    </div>
                  }
                  getItemKey={(item) => item.id}
                  items={eventsQuery.data?.items ?? []}
                  pagination={{
                    itemLabel: 'logins',
                    onPageChange: (nextPage) => pushSearch({ page: nextPage }),
                    page: currentPage,
                    pageSize:
                      eventsQuery.data?.pageSize ?? defaultSecurityPageLimit,
                    total: eventsQuery.data?.total ?? 0,
                  }}
                  renderMobileCard={(item) => (
                    <article className="grid gap-3 rounded-3xl border border-border bg-card p-5 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-foreground">
                            {item.userName ?? 'Nao identificado'}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {item.identifier}
                          </p>
                        </div>
                        <StatusBadge
                          tone={item.status === 'success' ? 'success' : 'error'}
                        >
                          {loginStatusLabels[item.status as LoginEventStatus]}
                        </StatusBadge>
                      </div>
                      {item.failureReason ? (
                        <span className="text-xs text-muted-foreground">
                          {item.failureReason}
                        </span>
                      ) : null}
                      <div className="grid gap-1">
                        <span className="text-sm text-foreground">
                          {item.ipAddress || 'IP nao informado'}
                        </span>
                        <LocationCell
                          city={item.city}
                          country={item.country}
                          region={item.region}
                        />
                        <DeviceCell userAgent={item.userAgent} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(item.createdAt)}
                      </p>
                    </article>
                  )}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </SettingsLayout>

      <AppDialog
        description={
          revokeTarget
            ? `A sessao de ${revokeTarget.userName} sera encerrada imediatamente.`
            : undefined
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => setRevokeTarget(null)}
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
            <Button
              disabled={revokeMutation.isPending}
              onClick={() => void handleConfirmRevoke()}
              type="button"
              variant="destructive"
            >
              {revokeMutation.isPending ? 'Revogando...' : 'Revogar sessao'}
            </Button>
          </div>
        }
        icon={ShieldOff}
        maxWidth="md"
        onClose={() => setRevokeTarget(null)}
        open={!!revokeTarget}
        title="Revogar sessao"
        variant="destructive"
      >
        <p className="text-sm text-muted-foreground">
          O usuario precisara fazer login novamente para continuar acessando a
          plataforma.
        </p>
      </AppDialog>
    </div>
  )
}
