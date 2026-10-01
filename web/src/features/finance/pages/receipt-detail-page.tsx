import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Ban, Calculator, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { useSession } from '@/features/auth/hooks/use-session'
import { AppDialog } from '@/shared/components/app-dialog'
import { PageHeader } from '@/shared/components/page-header'
import { AttachmentsPanel } from '../components/attachments-panel'
import {
  BlocksPanel,
  type Calculation,
  CalculationMemory,
} from '../components/calculation-memory'
import {
  BackLink,
  ErrorState,
  FinanceSection,
  LoadingState,
  Money,
  Tone,
} from '../components/finance-ui'
import { formatCivilDate, formatInstant } from '../lib/finance-money'
import {
  creditStatusLabels,
  financeAccess,
  receiptKindLabels,
  receiptStatusLabels,
} from '../lib/finance-labels'
import {
  useApproveReceipt,
  useCalculateReceipt,
  useCancelReceipt,
} from '../services/finance.mutations'
import { receiptQuery } from '../services/finance.queries'

const auditLabels: Record<string, string> = {
  CRIADO: 'Entrada registrada',
  ALTERADO: 'Entrada alterada',
  PREVIA_CALCULADA: 'Distribuição calculada',
  BLOQUEADO: 'Cálculo bloqueado',
  APROVADO: 'Distribuição aprovada para finalização',
  CANCELADO: 'Entrada cancelada',
}

export function ReceiptDetailPage({ receiptId }: { receiptId: string }) {
  const { permissions } = useSession()
  const query = useQuery(receiptQuery(receiptId))
  const calculate = useCalculateReceipt()
  const approve = useApproveReceipt()
  const [cancelOpen, setCancelOpen] = useState(false)

  if (query.isPending) return <LoadingState rows={8} />
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />

  const {
    receipt,
    process,
    attachments: _unused,
    history,
    closings,
    credits,
    processReceipts,
  } = query.data
  const calculation = receipt.lastCalculation as Calculation | null
  const open = ['RASCUNHO', 'EM_PREVIA', 'BLOQUEADO', 'APTO'].includes(
    receipt.status,
  )
  const others = processReceipts.filter((item) => item.id !== receipt.id)

  return (
    <div className="flex flex-col gap-6">
      <BackLink label="Entradas" to="/pagamentos/recebimentos" />
      <PageHeader
        description={`${process.code} · ${process.clientName}`}
        eyebrow="Financeiro · entrada"
        title={receiptKindLabels[receipt.kind] ?? receipt.kind}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Tone map={receiptStatusLabels} value={receipt.status} />
          {open && financeAccess.lancar(permissions) ? (
            <Button
              disabled={calculate.isPending}
              onClick={() =>
                calculate.mutate(receipt.id, {
                  onSuccess: () => toast.success('Distribuição recalculada.'),
                })
              }
              variant="outline"
            >
              <Calculator className="size-4" />
              {receipt.status === 'RASCUNHO'
                ? 'Calcular distribuição'
                : 'Recalcular distribuição'}
            </Button>
          ) : null}
          {receipt.status === 'EM_PREVIA' &&
          financeAccess.conferir(permissions) ? (
            <Button
              disabled={approve.isPending}
              onClick={() =>
                approve.mutate(receipt.id, {
                  onSuccess: () =>
                    toast.success('Distribuição aprovada e pronta para finalizar.'),
                })
              }
            >
              <CheckCircle2 className="size-4" />
              Aprovar distribuição
            </Button>
          ) : null}
          {open && financeAccess.lancar(permissions) ? (
            <Button onClick={() => setCancelOpen(true)} variant="ghost">
              <Ban className="size-4" />
              Cancelar entrada
            </Button>
          ) : null}
        </div>
      </PageHeader>

      <FinanceSection title="Entrada registrada">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Item
            label="Valor que entrou"
            value={<Money cents={receipt.amountCents} strong />}
          />
          <Item
            label="Data da entrada/liberação"
            value={formatCivilDate(receipt.releaseDate)}
          />
          <Item
            label="Condomínio"
            value={process.housingComplexName ?? 'Sem condomínio'}
          />
          <Item
            label="Data de cadastro do cliente (define a vigência)"
            value={formatCivilDate(receipt.clientRegistrationDate)}
          />
          <Item label="Referência" value={receipt.reference || '—'} />
          <Item
            label="Origem do dinheiro"
            value={receipt.originDescription || '—'}
          />
          <Item
            label="Registrado em"
            value={formatInstant(receipt.createdAt)}
          />
          <Item label="Aprovado em" value={formatInstant(receipt.approvedAt)} />
        </dl>
      </FinanceSection>

      {calculation?.warnings?.length ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {calculation.warnings.join(' ')}
        </p>
      ) : null}

      <FinanceSection
        description={
          calculation
            ? `Calculado em ${formatInstant(receipt.lastCalculatedAt)}. Veja primeiro para onde o valor foi destinado; os detalhes técnicos ficam recolhidos abaixo.`
            : 'A distribuição ainda não foi calculada.'
        }
        title="Distribuição do valor"
      >
        {!calculation ? (
          <p className="text-sm text-muted-foreground">
            Clique em “Calcular distribuição”. O sistema localizará as regras válidas e
            mostrará quanto vai para cada recebedor, provisão e reserva.
          </p>
        ) : calculation.blocked ? (
          <BlocksPanel blocks={calculation.blocks} />
        ) : (
          <CalculationMemory calculation={calculation} />
        )}
      </FinanceSection>

      {credits.length > 0 ? (
        <FinanceSection
          description="Estes valores foram liberados quando a distribuição foi finalizada. Pago e saldo são atualizados pelos pagamentos registrados."
          title="Valores liberados para pagamento"
        >
          <ul className="grid gap-1.5 text-sm">
            {credits.map((credit) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                key={credit.id}
              >
                <span>{credit.recipientName}</span>
                <span className="flex items-center gap-2">
                  <Money cents={credit.amountCents + credit.adjustedCents} />
                  <Tone map={creditStatusLabels} value={credit.status} />
                </span>
              </li>
            ))}
          </ul>
          {closings.map((closing) => (
            <Link
              className="mt-2 inline-block text-sm text-primary"
              key={closing.closingId}
              params={{ closingId: closing.closingId }}
              preload={false}
              to="/pagamentos/fechamentos/$closingId"
            >
              Abrir distribuição {closing.code}
              {closing.isActive ? '' : ' (estornada)'}
            </Link>
          ))}
        </FinanceSection>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <FinanceSection title="Comprovante da entrada">
          <AttachmentsPanel
            canUpload={
              financeAccess.lancar(permissions) &&
              receipt.status !== 'CANCELADO'
            }
            ownerId={receipt.id}
            ownerKind="receipt"
          />
        </FinanceSection>
        <FinanceSection
          description="Cada entrada do processo tem sua própria distribuição; uma reserva configurada como única por processo não é criada duas vezes."
          title="Outras entradas do processo"
        >
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Esta é a primeira entrada deste processo.
            </p>
          ) : (
            <ul className="grid gap-1.5 text-sm">
              {others.map((other) => (
                <li key={other.id}>
                  <Link
                    className="flex justify-between gap-2 rounded-md border border-border px-3 py-2 no-underline hover:bg-muted"
                    params={{ receiptId: other.id }}
                    preload={false}
                    to="/pagamentos/recebimentos/$receiptId"
                  >
                    <span>{formatCivilDate(other.releaseDate)}</span>
                    <span className="flex items-center gap-2">
                      <Money cents={other.amountCents} />
                      <Tone map={receiptStatusLabels} value={other.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </FinanceSection>
      </div>

      <FinanceSection title="Histórico da entrada">
        <ol className="grid gap-1 text-sm">
          {history.map((entry) => (
            <li className="flex flex-wrap justify-between gap-2" key={entry.id}>
              <span>
                {auditLabels[entry.action] ?? entry.action}
                {entry.reason ? ` — ${entry.reason}` : ''}
              </span>
              <span className="text-muted-foreground">
                {formatInstant(entry.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      </FinanceSection>

      {cancelOpen ? (
        <CancelDialog
          onClose={() => setCancelOpen(false)}
          receiptId={receipt.id}
        />
      ) : null}
    </div>
  )
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function CancelDialog({
  receiptId,
  onClose,
}: {
  receiptId: string
  onClose: () => void
}) {
  const mutation = useCancelReceipt()
  const [reason, setReason] = useState('')
  return (
    <AppDialog
      footer={
        <Button
          disabled={reason.trim().length < 3 || mutation.isPending}
          onClick={() =>
            mutation.mutate(
              { id: receiptId, reason },
              {
                onSuccess: () => {
                  toast.success('Entrada cancelada.')
                  onClose()
                },
              },
            )
          }
          variant="destructive"
        >
          Cancelar entrada
        </Button>
      }
      icon={Ban}
      maxWidth="md"
      onClose={onClose}
      open
      title="Cancelar entrada"
      variant="destructive"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="cancel-reason">Motivo (fica no histórico)</Label>
        <Textarea
          id="cancel-reason"
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          value={reason}
        />
      </div>
    </AppDialog>
  )
}
