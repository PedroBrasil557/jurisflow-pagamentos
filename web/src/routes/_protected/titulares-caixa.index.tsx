import { createFileRoute, redirect } from '@tanstack/react-router'
import { TitularesCaixaPage } from '@/features/titulares-caixa/pages/titulares-caixa-page'
import { parseTitularesSearch } from '@/features/titulares-caixa/schemas/titulares-caixa-search.schema'

export const Route = createFileRoute('/_protected/titulares-caixa/')({
  // Tela admin-only: dados sensiveis (CPF/PIS) e import em massa.
  beforeLoad: ({ context }) => {
    if (!context.permissions.isAdmin) {
      throw redirect({ to: '/' })
    }
  },
  validateSearch: (search: Record<string, unknown>) =>
    parseTitularesSearch(search),
  component: TitularesRoute,
})

function TitularesRoute() {
  const search = Route.useSearch()

  return (
    <TitularesCaixaPage
      currentAssinaturaFrom={search.assinaturaFrom}
      currentAssinaturaTo={search.assinaturaTo}
      currentAverbacoes={search.averbacoes ?? []}
      currentEmpreendimento={search.empreendimento ?? []}
      currentLogradouros={search.logradouros ?? []}
      currentModalidade={search.modalidade ?? []}
      currentMunicipio={search.municipio ?? ''}
      currentPage={search.page ?? 1}
      currentQuitacaoStatuses={search.quitacaoStatuses ?? []}
      currentSearch={search.search ?? ''}
      currentUf={search.uf ?? []}
    />
  )
}
