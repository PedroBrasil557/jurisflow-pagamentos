import { createFileRoute } from '@tanstack/react-router'
import { EditProcessPage } from '@/features/processes/pages/process-editor-page'

export const Route = createFileRoute('/_protected/processos/$processId/editar')(
  {
    component: EditProcessRoute,
  },
)

function EditProcessRoute() {
  const { processId } = Route.useParams()

  return <EditProcessPage key={processId} processId={processId} />
}
