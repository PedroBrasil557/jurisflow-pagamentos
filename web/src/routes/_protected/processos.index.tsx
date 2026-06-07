import { createFileRoute } from '@tanstack/react-router'
import { ProcessesPage } from '@/features/processes/pages/processes-page'
import { parseProcessesSearch } from '@/features/processes/schemas/processes-search.schema'

export const Route = createFileRoute('/_protected/processos/')({
  validateSearch: (search: Record<string, unknown>) =>
    parseProcessesSearch(search),
  component: ProcessesRoute,
})

function ProcessesRoute() {
  const search = Route.useSearch()

  return (
    <ProcessesPage
      currentCreatedFrom={search.createdFrom}
      currentCreatedTo={search.createdTo}
      currentPage={search.page ?? 1}
      currentSearch={search.search ?? ''}
      currentStatuses={search.statuses ?? []}
    />
  )
}
