import { createFileRoute } from '@tanstack/react-router'
import { ProcessChecklistPage } from '@/features/processes/pages/process-checklist-page'

export const Route = createFileRoute(
  '/_protected/processos/$processId/checklist',
)({
  component: ProcessChecklistRoute,
})

function ProcessChecklistRoute() {
  const { processId } = Route.useParams()

  return <ProcessChecklistPage processId={processId} />
}
