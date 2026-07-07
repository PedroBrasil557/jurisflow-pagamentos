import type { TitularCaixaStatsPorLocal } from '../../services/dashboard.service'
import type { TitularCaixaScope } from './titular-caixa-scope-filter'
import { TitularesPorLocalTable } from './titulares-por-local-table'
import { TitularesPorMunicipioChart } from './titulares-por-municipio-chart'

type Municipios = TitularCaixaStatsPorLocal['municipios']

type TitularesPorLocalSectionProps = {
  // Ja filtrados pelo escopo escolhido na aba.
  municipios: Municipios
  scope: TitularCaixaScope
}

function rotuloEmpreendimento(item: {
  empreendimento: string
  logradouro: string | null
}) {
  return item.logradouro
    ? `${item.empreendimento} — ${item.logradouro}`
    : item.empreendimento
}

// Secao "por local". Recebe os municipios ja filtrados pelo escopo e adapta o
// recorte: com um municipio selecionado, o grafico passa a mostrar os
// empreendimentos daquele municipio (uma unica barra de municipio nao ajuda).
export function TitularesPorLocalSection({
  municipios,
  scope,
}: TitularesPorLocalSectionProps) {
  const municipioMode = scope.municipio !== null

  const heading = municipioMode
    ? `Detalhe · ${scope.municipio}/${scope.uf}`
    : scope.uf
      ? `Por municipio · ${scope.uf}`
      : 'Por municipio'

  const chartTitle = municipioMode
    ? 'Titulares por empreendimento'
    : 'Titulares por municipio'

  const chartItems = municipioMode
    ? (municipios[0]?.empreendimentos ?? []).map((empreendimento) => ({
        label: rotuloEmpreendimento(empreendimento),
        total: empreendimento.indicadores.total,
      }))
    : municipios.map((municipio) => ({
        label: `${municipio.municipio} – ${municipio.uf}`,
        total: municipio.indicadores.total,
      }))

  return (
    <div className="grid gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{heading}</h2>
      {chartItems.length > 0 ? (
        <TitularesPorMunicipioChart baseTitle={chartTitle} items={chartItems} />
      ) : null}
      <TitularesPorLocalTable municipios={municipios} />
    </div>
  )
}
