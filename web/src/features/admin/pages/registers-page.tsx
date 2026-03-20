import { useQuery } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import {
  Building2,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { getUserRoleLabel } from '@/features/auth/auth.roles'
import { formatCpf } from '@/features/processes/process-form.utils'
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
import { CreateHousingComplexDialog } from '../components/create-housing-complex-dialog'
import { CreateUserModal } from '../components/create-user-modal'
import { DeleteHousingComplexDialog } from '../components/delete-housing-complex-dialog'
import { EditHousingComplexDialog } from '../components/edit-housing-complex-dialog'
import { EditUserDialog } from '../components/edit-user-dialog'
import { ResetUserDialog } from '../components/reset-user-dialog'
import { adminHousingComplexListOptions } from '../services/admin-housing-complexes.queries'
import {
  defaultHousingComplexPageLimit,
  type HousingComplexListItem,
} from '../services/admin-housing-complexes.service'
import { adminUserListOptions } from '../services/admin-users.queries'
import {
  type AdminUserListItem,
  defaultAdminUsersPageLimit,
} from '../services/admin-users.service'

const protectedRouteApi = getRouteApi('/_protected')

function isInternalEmail(email: string) {
  return email.endsWith('@internal.local')
}

export type RegistersPageProps = {
  currentPage: number
  currentSearch: string
}

type ActiveTab = 'users' | 'housing-complexes'

function getUserRoleTone(role: string) {
  switch (role) {
    case 'admin':
      return 'error' as const
    case 'attorney':
      return 'info' as const
    default:
      return 'ghost' as const
  }
}

function UserRoleBadge({ role }: { role: string }) {
  return (
    <StatusBadge tone={getUserRoleTone(role)}>
      {getUserRoleLabel(role)}
    </StatusBadge>
  )
}

function UserStatusBadges({ user }: { user: AdminUserListItem }) {
  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge tone={user.isActive ? 'success' : 'warning'}>
        {user.isActive ? 'Ativo' : 'Inativo'}
      </StatusBadge>
      {user.mustChangePassword ? (
        <Badge variant="outline">Troca de senha pendente</Badge>
      ) : null}
    </div>
  )
}

function CreatedByCell({ user }: { user: AdminUserListItem }) {
  if (!user.createdByName) {
    return <span className="text-xs text-muted-foreground">Bootstrap</span>
  }

  return (
    <div className="grid gap-1">
      <p className="font-medium text-foreground">{user.createdByName}</p>
      <p className="text-xs text-muted-foreground">
        {formatDateTime(user.createdAt)}
      </p>
    </div>
  )
}

export function RegistersPage({
  currentPage,
  currentSearch,
}: RegistersPageProps) {
  const { user } = protectedRouteApi.useRouteContext()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<ActiveTab>('users')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [resetTarget, setResetTarget] = useState<AdminUserListItem | null>(null)
  const [editTarget, setEditTarget] = useState<AdminUserListItem | null>(null)
  const [search, setSearch] = useState(currentSearch)
  const debouncedSearch = useDebouncedValue(search)

  const [isCreateHcDialogOpen, setIsCreateHcDialogOpen] = useState(false)
  const [editHcTarget, setEditHcTarget] =
    useState<HousingComplexListItem | null>(null)
  const [deleteHcTarget, setDeleteHcTarget] =
    useState<HousingComplexListItem | null>(null)
  const [hcSearch, setHcSearch] = useState('')
  const debouncedHcSearch = useDebouncedValue(hcSearch)
  const [hcPage, setHcPage] = useState(1)

  const usersQuery = useQuery(
    adminUserListOptions({
      limit: defaultAdminUsersPageLimit,
      page: currentPage,
      search: debouncedSearch,
    }),
  )

  const hcQuery = useQuery(
    adminHousingComplexListOptions({
      limit: defaultHousingComplexPageLimit,
      page: hcPage,
      search: debouncedHcSearch,
    }),
  )

  const usersData = usersQuery.data
  const hcData = hcQuery.data

  useEffect(() => {
    if (activeTab !== 'users') {
      return
    }

    if (debouncedSearch === currentSearch) {
      return
    }

    void navigate({
      replace: true,
      search: {
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        page: 1,
      },
      to: '/cadastros',
    })
  }, [activeTab, currentSearch, debouncedSearch, navigate])

  const prevHcSearchRef = useRef(debouncedHcSearch)
  useEffect(() => {
    if (prevHcSearchRef.current !== debouncedHcSearch) {
      prevHcSearchRef.current = debouncedHcSearch
      setHcPage(1)
    }
  }, [debouncedHcSearch])

  function handleCreatedUser(payload: { temporaryPassword?: string | null }) {
    toast.success(
      payload.temporaryPassword
        ? 'Usuario criado. A senha temporaria foi exibida para copia.'
        : 'Usuario criado com sucesso.',
    )
  }

  function handleTabChange(tab: ActiveTab) {
    setActiveTab(tab)
  }

  const userColumns = useMemo<readonly DataTableColumn<AdminUserListItem>[]>(
    () => [
      {
        id: 'user',
        header: 'Usuario',
        render: (item) => (
          <div className="grid gap-1">
            <p className="font-medium text-foreground">{item.name}</p>
            {isInternalEmail(item.email) ? null : (
              <p className="text-sm text-muted-foreground">{item.email}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {formatCpf(item.cpf ?? '')}
            </p>
          </div>
        ),
      },
      {
        id: 'role',
        header: 'Perfil',
        render: (item) => <UserRoleBadge role={item.role} />,
      },
      {
        id: 'status',
        header: 'Status',
        render: (item) => <UserStatusBadges user={item} />,
      },
      {
        id: 'createdBy',
        header: 'Criado por',
        render: (item) => <CreatedByCell user={item} />,
      },
      {
        id: 'actions',
        header: 'Acoes',
        render: (item) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="Acoes do usuario" size="icon" variant="ghost">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setEditTarget(item)}>
                <Pencil className="size-4" />
                Editar
              </DropdownMenuItem>
              {item.id !== user.id ? (
                <DropdownMenuItem onClick={() => setResetTarget(item)}>
                  <KeyRound className="size-4" />
                  Resetar conta
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [user.id],
  )

  const hcColumns = useMemo<readonly DataTableColumn<HousingComplexListItem>[]>(
    () => [
      {
        id: 'name',
        header: 'Nome',
        render: (item) => (
          <p className="font-medium text-foreground">{item.name}</p>
        ),
      },
      {
        id: 'createdAt',
        header: 'Criado em',
        render: (item) => (
          <p className="text-sm text-muted-foreground">
            {formatDateTime(item.createdAt)}
          </p>
        ),
      },
      {
        id: 'actions',
        header: 'Acoes',
        render: (item) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Acoes do conjunto"
                size="icon"
                variant="ghost"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setEditHcTarget(item)}>
                <Pencil className="size-4" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDeleteHcTarget(item)}>
                <Trash2 className="size-4" />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [],
  )

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Cadastros"
        description="Gerencie os registros da plataforma."
      />

      <SettingsLayout
        items={[
          {
            icon: Users,
            isActive: activeTab === 'users',
            label: 'Usuarios',
            onClick: () => handleTabChange('users'),
          },
          {
            icon: Building2,
            isActive: activeTab === 'housing-complexes',
            label: 'Conjuntos',
            onClick: () => handleTabChange('housing-complexes'),
          },
        ]}
      >
        {activeTab === 'users' ? (
          <div className="grid gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SearchInput
                containerClassName="w-full sm:max-w-sm"
                onChange={(event) => {
                  setSearch(event.target.value)
                }}
                placeholder="Buscar por nome, e-mail ou CPF..."
                value={search}
              />

              <Button onClick={() => setIsCreateModalOpen(true)} type="button">
                <Plus className="size-4" />
                Novo usuario
              </Button>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {usersQuery.isFetching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              <span>{usersData?.total ?? 0} registros</span>
            </div>

            <Card className="overflow-hidden">
              <CardContent className="overflow-x-auto px-0 sm:px-0">
                <DataTable
                  ariaLabel="Tabela de usuarios cadastrados"
                  columns={userColumns}
                  emptyState={
                    <div className="rounded-[1.75rem] border border-dashed border-border bg-muted/25 px-6 py-10 text-center">
                      <p className="text-sm font-medium text-muted-foreground">
                        Nenhum usuario encontrado
                      </p>
                    </div>
                  }
                  getItemKey={(item) => item.id}
                  items={usersData?.items ?? []}
                  pagination={{
                    itemLabel: 'usuarios',
                    onPageChange: (nextPage) => {
                      if (nextPage === currentPage) {
                        return
                      }

                      void navigate({
                        search: {
                          ...(currentSearch ? { search: currentSearch } : {}),
                          page: nextPage,
                        },
                        to: '/cadastros',
                      })
                    },
                    page: currentPage,
                    pageSize: usersData?.pageSize ?? defaultAdminUsersPageLimit,
                    total: usersData?.total ?? 0,
                  }}
                  renderMobileCard={(item) => (
                    <article className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                      <div className="grid gap-4">
                        <div className="flex items-start justify-between">
                          <div className="grid gap-1">
                            <p className="font-medium text-foreground">
                              {item.name}
                            </p>
                            {isInternalEmail(item.email) ? null : (
                              <p className="text-sm text-muted-foreground">
                                {item.email}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {formatCpf(item.cpf ?? '')}
                            </p>
                          </div>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                aria-label="Acoes do usuario"
                                size="icon"
                                variant="ghost"
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem>
                                <Pencil className="size-4" />
                                Editar
                              </DropdownMenuItem>
                              {item.id !== user.id ? (
                                <DropdownMenuItem
                                  onClick={() => setResetTarget(item)}
                                >
                                  <KeyRound className="size-4" />
                                  Resetar conta
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <UserRoleBadge role={item.role} />
                        </div>

                        <UserStatusBadges user={item} />

                        <div className="rounded-2xl border border-border bg-muted/30 p-4">
                          <p className="text-xs font-medium text-muted-foreground">
                            Criado por
                          </p>
                          <div className="mt-2">
                            <CreatedByCell user={item} />
                          </div>
                        </div>
                      </div>
                    </article>
                  )}
                />
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SearchInput
                containerClassName="w-full sm:max-w-sm"
                onChange={(event) => {
                  setHcSearch(event.target.value)
                }}
                placeholder="Buscar por nome..."
                value={hcSearch}
              />

              <Button
                onClick={() => setIsCreateHcDialogOpen(true)}
                type="button"
              >
                <Plus className="size-4" />
                Novo conjunto
              </Button>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {hcQuery.isFetching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              <span>{hcData?.total ?? 0} registros</span>
            </div>

            <Card className="overflow-hidden">
              <CardContent className="overflow-x-auto px-0 sm:px-0">
                <DataTable
                  ariaLabel="Tabela de conjuntos cadastrados"
                  columns={hcColumns}
                  emptyState={
                    <div className="rounded-[1.75rem] border border-dashed border-border bg-muted/25 px-6 py-10 text-center">
                      <p className="text-sm font-medium text-muted-foreground">
                        Nenhum conjunto encontrado
                      </p>
                    </div>
                  }
                  getItemKey={(item) => item.id}
                  items={hcData?.items ?? []}
                  pagination={{
                    itemLabel: 'conjuntos',
                    onPageChange: (nextPage) => {
                      setHcPage(nextPage)
                    },
                    page: hcPage,
                    pageSize:
                      hcData?.pageSize ?? defaultHousingComplexPageLimit,
                    total: hcData?.total ?? 0,
                  }}
                  renderMobileCard={(item) => (
                    <article className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                      <div className="grid gap-4">
                        <div className="flex items-start justify-between">
                          <div className="grid gap-1">
                            <p className="font-medium text-foreground">
                              {item.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDateTime(item.createdAt)}
                            </p>
                          </div>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                aria-label="Acoes do conjunto"
                                size="icon"
                                variant="ghost"
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem
                                onClick={() => setEditHcTarget(item)}
                              >
                                <Pencil className="size-4" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setDeleteHcTarget(item)}
                              >
                                <Trash2 className="size-4" />
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </article>
                  )}
                />
              </CardContent>
            </Card>
          </div>
        )}
      </SettingsLayout>

      {isCreateModalOpen ? (
        <CreateUserModal
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={handleCreatedUser}
        />
      ) : null}

      {resetTarget ? (
        <ResetUserDialog
          onClose={() => setResetTarget(null)}
          user={resetTarget}
        />
      ) : null}

      {editTarget ? (
        <EditUserDialog
          onClose={() => setEditTarget(null)}
          open={!!editTarget}
          user={editTarget}
        />
      ) : null}

      {isCreateHcDialogOpen ? (
        <CreateHousingComplexDialog
          onClose={() => setIsCreateHcDialogOpen(false)}
        />
      ) : null}

      {editHcTarget ? (
        <EditHousingComplexDialog
          housingComplex={editHcTarget}
          onClose={() => setEditHcTarget(null)}
        />
      ) : null}

      {deleteHcTarget ? (
        <DeleteHousingComplexDialog
          housingComplex={deleteHcTarget}
          onClose={() => setDeleteHcTarget(null)}
        />
      ) : null}
    </div>
  )
}
