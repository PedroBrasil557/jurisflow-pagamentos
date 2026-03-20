import { createFileRoute } from '@tanstack/react-router'
import { NewProcessPage } from '@/features/processes/pages/process-editor-page'

export const Route = createFileRoute('/_protected/processos/novo')({
  component: NewProcessPage,
})
