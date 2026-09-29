import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { useSession } from '@/features/auth/hooks/use-session'
import { PageHeader } from '@/shared/components/page-header'
import { SearchInput } from '@/shared/components/search-input'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  Tone,
} from '../components/finance-ui'
import { formatCivilDate } from '../lib/finance-money'
import {
  financeAccess,
  receiptKindLabels,
  receiptStatusLabels,
} from '../lib/finance-labels'
import { receiptsQuery } from '../services/finance.queries'
import type { ReceiptStatus } from '../services/finance.service'

export function ReceiptsPage() {
  const { permissions } = useSession()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ReceiptStatus | ''>('')
  const query = useQuery(
    receiptsQuery({
      search: search || undefined,
      status: status ? [status] : undefined,
    }),
  )
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Toda entrada de dinheiro começa aqui. Depois ela é calculada, conferida e transformada em destinos visíveis para cada centavo."
        eyebrow="Pagamentos"
        title="Entradas"
      >
        {financeAccess.lancar(permissions) ? (
          <Button asChild>
            <Link
              className="no-underline"
              preload={false}
              to="/pagamentos/recebimentos/novo"
            >
              <Plus className="size-4" />
              Registrar entrada
            </Link>
          </Button>
        ) : null}
      </PageHeader>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <SearchInput
            aria-label="Buscar entradas"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por processo, cliente ou referência"
            value={search}
          />
        </div>
        <NativeSelect
          aria-label="Filtrar por situação"
          className="sm:w-64"
          onChange={(e) => setStatus(e.target.value as ReceiptStatus | '')}
          value={status}
        >
          <NativeSelectOption value="">Todas as situações</NativeSelectOption>
          {Object.entries(receiptStatusLabels).map(([key, value]) => (
            <NativeSelectOption key={key} value={key}>
              {value.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {query.isPending ? <LoadingState /> : null}
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : null}
      {query.data?.length === 0 ? (
        <EmptyState
          description={
            search || status
              ? 'Nenhuma entrada encontrada para o filtro.'
              : 'Nenhuma entrada de dinheiro foi registrada ainda.'
          }
          title="Sem entradas"
        />
      ) : null}
      {query.data && query.data.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Processo / cliente</TableHead>
                <TableHead>Condomínio</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Data da entrada</TableHead>
                <TableHead className="text-right">Valor que entrou</TableHead>
                <TableHead>Etapa atual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((receipt) => (
                <TableRow key={receipt.id}>
                  <TableCell>
                    <Link
                      className="font-medium text-primary"
                      params={{ receiptId: receipt.id }}
                      preload={false}
                      to="/pagamentos/recebimentos/$receiptId"
                    >
                      {receipt.processCode}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {receipt.clientName}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {receipt.housingComplexName ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {receiptKindLabels[receipt.kind]}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatCivilDate(receipt.releaseDate)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money cents={receipt.amountCents} />
                  </TableCell>
                  <TableCell>
                    <Tone map={receiptStatusLabels} value={receipt.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  )
}
