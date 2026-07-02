import { AlertTriangle } from 'lucide-react'

// Pendencia bloqueante derivada (reviewFlag), vinda da resposta do checklist.
type ReviewFlag = {
  code: string
  titulo: string
  detalhe: string
  docKey?: string
}

// Banner "para concluir, resolva" no topo do checklist: lista as validacoes de
// negocio que IMPEDEM o avanco para "Documentacao pronta" (ex.: data do contrato de
// compra e venda fora do prazo legal, tipo de proprietario ambiguo). Some quando
// nao ha pendencias. E a explicacao do "por que o processo nao conclui".
export function ChecklistPendenciasBanner({
  reviewFlags,
}: {
  reviewFlags: ReviewFlag[]
}) {
  if (!reviewFlags || reviewFlags.length === 0) {
    return null
  }

  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-4" />
        <p className="font-semibold">
          Para concluir, resolva ({reviewFlags.length})
        </p>
      </div>

      <ul className="mt-3 grid gap-3">
        {reviewFlags.map((flag) => (
          <li className="grid gap-0.5" key={flag.code}>
            <span className="font-medium text-foreground">{flag.titulo}</span>
            <span className="text-muted-foreground text-sm">
              {flag.detalhe}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-amber-500/20 border-t pt-2 text-muted-foreground text-xs">
        Enquanto houver pendências, o processo não avança para "Documentação
        pronta".
      </p>
    </div>
  )
}
