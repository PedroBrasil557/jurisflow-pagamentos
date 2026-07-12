import { createFileRoute, redirect } from '@tanstack/react-router'
import { canViewTitularesCaixa } from '@/features/titulares-caixa/lib/titulares-access'
import { TitularesCaixaPage } from '@/features/titulares-caixa/pages/titulares-caixa-page'
import { parseTitularesSearch } from '@/features/titulares-caixa/schemas/titulares-caixa-search.schema'

export const Route = createFileRoute('/_protected/titulares-caixa/')({
  // Acesso por permissao de perfil (dados sensiveis CPF/PIS — conceder com criterio).
  beforeLoad: ({ context }) => {
    if (!canViewTitularesCaixa(context.permissions)) {
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
      currentConjuntoIds={search.conjuntoIds ?? []}
      currentEmpreendimento={search.empreendimento ?? []}
      currentLogradouros={search.logradouros ?? []}
      currentModalidade={search.modalidade ?? []}
      currentMunicipio={search.municipio ?? ''}
      currentPage={search.page ?? 1}
      currentQuitacaoStatuses={search.quitacaoStatuses ?? []}
      currentSearch={search.search ?? ''}
      currentTerceiro={search.terceiro}
      currentUf={search.uf ?? []}
    />
  )
}
