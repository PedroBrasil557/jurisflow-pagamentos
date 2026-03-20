import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_protected/processos')({
  component: ProcessesRoute,
})

function ProcessesRoute() {
  return <Outlet />
}
