import { ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Card, CardContent } from '#/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { cn } from '#/lib/utils'
import type { TitularCaixaStatsPorLocal } from '../../services/dashboard.service'

type Municipios = TitularCaixaStatsPorLocal['municipios']
type Indicadores = Municipios[number]['indicadores']

type TitularesPorLocalTableProps = {
  municipios: Municipios
}

function chaveMunicipio(item: Municipios[number]) {
  return `${item.uf}|${item.municipio}`
}

function rotuloEmpreendimento(item: {
  empreendimento: string
  logradouro: string | null
}) {
  return item.logradouro
    ? `${item.empreendimento} — ${item.logradouro}`
    : item.empreendimento
}

function percentualQuitados(indicadores: Indicadores) {
  if (indicadores.total === 0) {
    return '—'
  }
  return `${Math.round((indicadores.quitado / indicadores.total) * 100)}%`
}

function AverbacaoResumo({
  averbacao,
}: {
  averbacao: Indicadores['averbacao']
}) {
  const { sim, nao, indeterminado } = averbacao
  if (sim === 0 && nao === 0 && indeterminado === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <span className="whitespace-nowrap text-muted-foreground">
      sim{' '}
      <span className="font-medium text-green-600 dark:text-green-500">
        {sim}
      </span>
      {' · '}nao{' '}
      <span className="font-medium text-red-600 dark:text-red-500">{nao}</span>
      {' · '}ind.{' '}
      <span className="font-medium text-amber-600 dark:text-amber-500">
        {indeterminado}
      </span>
    </span>
  )
}

// Mini-grid de indicadores usada nos cards mobile (municipio e empreendimento).
function IndicadoresResumo({ indicadores }: { indicadores: Indicadores }) {
  const itens = [
    { rotulo: 'Quitados', valor: String(indicadores.quitado) },
    { rotulo: 'Pendentes', valor: String(indicadores.pendente) },
    { rotulo: 'Sem exito', valor: String(indicadores.semExito) },
    { rotulo: '% quitados', valor: percentualQuitados(indicadores) },
  ]
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {itens.map((item) => (
          <div
            className="flex items-baseline justify-between"
            key={item.rotulo}
          >
            <dt className="text-muted-foreground">{item.rotulo}</dt>
            <dd className="font-medium tabular-nums">{item.valor}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">
        <span className="text-muted-foreground">Averbacao: </span>
        <AverbacaoResumo averbacao={indicadores.averbacao} />
      </p>
    </div>
  )
}

export function TitularesPorLocalTable({
  municipios,
}: TitularesPorLocalTableProps) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  function alternar(chave: string) {
    setExpandidos((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(chave)) {
        proximo.delete(chave)
      } else {
        proximo.add(chave)
      }
      return proximo
    })
  }

  if (municipios.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhum titular cadastrado.
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {/* Mobile: cards com expansao */}
      <div className="grid gap-4 xl:hidden">
        {municipios.map((municipio) => {
          const chave = chaveMunicipio(municipio)
          const aberto = expandidos.has(chave)
          return (
            <Card key={chave}>
              <CardContent className="space-y-3 pt-6">
                <button
                  aria-expanded={aberto}
                  className="flex w-full items-center gap-2 text-left"
                  onClick={() => alternar(chave)}
                  type="button"
                >
                  <ChevronRight
                    className={cn(
                      'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                      aberto && 'rotate-90',
                    )}
                  />
                  <span className="flex-1 font-medium">
                    {municipio.municipio} – {municipio.uf}
                  </span>
                  <span className="text-2xl font-semibold tracking-tight tabular-nums">
                    {municipio.indicadores.total}
                  </span>
                </button>
                <IndicadoresResumo indicadores={municipio.indicadores} />
                {aberto ? (
                  <div className="grid gap-3">
                    {municipio.empreendimentos.map((empreendimento) => (
                      <div
                        className="ml-3 border-l-2 pl-3"
                        key={rotuloEmpreendimento(empreendimento)}
                      >
                        <p className="mb-2 flex items-baseline justify-between gap-2 text-sm">
                          <span className="font-medium">
                            {rotuloEmpreendimento(empreendimento)}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {empreendimento.indicadores.total} tit.
                          </span>
                        </p>
                        <IndicadoresResumo
                          indicadores={empreendimento.indicadores}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Desktop: tabela hierarquica */}
      <Card className="hidden overflow-hidden xl:block">
        <CardContent className="overflow-x-auto px-0 sm:px-0">
          <Table aria-label="Titulares por municipio e empreendimento">
            <TableHeader>
              <TableRow>
                <TableHead>Municipio / empreendimento</TableHead>
                <TableHead className="text-right">Titulares</TableHead>
                <TableHead className="text-right">Quitados</TableHead>
                <TableHead className="text-right">Pendentes</TableHead>
                <TableHead className="text-right">Sem exito</TableHead>
                <TableHead className="text-right">% quitados</TableHead>
                <TableHead className="text-right">Averbacao</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {municipios.map((municipio) => {
                const chave = chaveMunicipio(municipio)
                const aberto = expandidos.has(chave)
                return (
                  <Fragment key={chave}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => alternar(chave)}
                    >
                      <TableCell>
                        <button
                          aria-expanded={aberto}
                          className="flex items-center gap-2 font-medium"
                          onClick={(event) => {
                            event.stopPropagation()
                            alternar(chave)
                          }}
                          type="button"
                        >
                          <ChevronRight
                            className={cn(
                              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                              aberto && 'rotate-90',
                            )}
                          />
                          {municipio.municipio} – {municipio.uf}
                        </button>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {municipio.indicadores.total}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {municipio.indicadores.quitado}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {municipio.indicadores.pendente}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {municipio.indicadores.semExito}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {percentualQuitados(municipio.indicadores)}
                      </TableCell>
                      <TableCell className="text-right">
                        <AverbacaoResumo
                          averbacao={municipio.indicadores.averbacao}
                        />
                      </TableCell>
                    </TableRow>
                    {aberto
                      ? municipio.empreendimentos.map((empreendimento) => (
                          <TableRow
                            className="bg-muted/30"
                            key={rotuloEmpreendimento(empreendimento)}
                          >
                            <TableCell className="pl-10 text-muted-foreground">
                              {rotuloEmpreendimento(empreendimento)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {empreendimento.indicadores.total}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {empreendimento.indicadores.quitado}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {empreendimento.indicadores.pendente}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {empreendimento.indicadores.semExito}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {percentualQuitados(empreendimento.indicadores)}
                            </TableCell>
                            <TableCell className="text-right">
                              <AverbacaoResumo
                                averbacao={empreendimento.indicadores.averbacao}
                              />
                            </TableCell>
                          </TableRow>
                        ))
                      : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
