import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import { Textarea } from '#/components/ui/textarea'
import { useSession } from '@/features/auth/hooks/use-session'
import { PageHeader } from '@/shared/components/page-header'
import { SearchInput } from '@/shared/components/search-input'
import {
  BackLink,
  DeniedState,
  FieldError,
  FinanceSection,
} from '../components/finance-ui'
import {
  formatCivilDate,
  parseBRLToCents,
  todayCivil,
} from '../lib/finance-money'
import { financeAccess, receiptKindLabels } from '../lib/finance-labels'
import {
  useCalculateReceipt,
  useCreateReceipt,
} from '../services/finance.mutations'
import { processOptionsQuery } from '../services/finance.queries'
import {
  newIdempotencyKey,
  type ProcessOption,
  type ReceiptPayload,
} from '../services/finance.service'

/** P01: registra a entrada; ainda ninguém é considerado pago. */
export function ReceiptNewPage() {
  const { permissions } = useSession()
  const navigate = useNavigate()
  const createMutation = useCreateReceipt()
  const calculateMutation = useCalculateReceipt()
  const [search, setSearch] = useState('')
  const processes = useQuery({
    ...processOptionsQuery(search),
    enabled: financeAccess.lancar(permissions),
  })
  const [selected, setSelected] = useState<ProcessOption | null>(null)
  const [kind, setKind] = useState<ReceiptPayload['kind']>(
    'HONORARIOS_CONTRATUAIS',
  )
  const [amount, setAmount] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [reference, setReference] = useState('')
  const [originDescription, setOriginDescription] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Mesma chave em reenvios desta intenção (duplo clique / falha de rede).
  const idempotencyKey = useMemo(() => newIdempotencyKey(), [])

  if (!financeAccess.lancar(permissions)) return <DeniedState />

  function submit(calculate: boolean) {
    setError(null)
    if (!selected) return setError('Selecione o processo.')
    const amountCents = parseBRLToCents(amount)
    if (!amountCents || amountCents <= 0)
      return setError('Informe o valor bruto (ex.: 12.000,00).')
    if (calculate && !releaseDate)
      return setError('Para calcular, informe a data de liberação.')
    createMutation.mutate(
      {
        idempotencyKey,
        processId: selected.id,
        kind,
        amountCents,
        releaseDate: releaseDate || null,
        reference: reference || undefined,
        originDescription: originDescription || undefined,
        description: description || undefined,
      },
      {
        onSuccess: ({ receipt }) => {
          const go = () =>
            navigate({
              to: '/pagamentos/recebimentos/$receiptId',
              params: { receiptId: receipt.id },
            })
          if (!calculate) {
            toast.success('Rascunho salvo.')
            return go()
          }
          calculateMutation.mutate(receipt.id, { onSettled: go })
        },
      },
    )
  }

  const pending = createMutation.isPending || calculateMutation.isPending

  return (
    <div className="flex flex-col gap-6">
      <BackLink label="Recebimentos" to="/pagamentos/recebimentos" />
      <PageHeader
        description="Registre um recebimento vinculado a um processo existente."
        eyebrow="Pagamentos · recebimento"
        title="Novo recebimento"
      />
      <Alert>
        <Info className="size-4" />
        <AlertDescription>
          O motor não conhece nomes nem percentuais fixos: o processo fornece o
          contexto (condomínio e data de cadastro do cliente) e as regras
          cadastradas fornecem participantes, bases e percentuais.
        </AlertDescription>
      </Alert>

      <FinanceSection title="Processo">
        <div className="grid gap-3">
          <SearchInput
            aria-label="Buscar processo"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Código do processo ou nome do cliente"
            value={search}
          />
          <div
            className="grid max-h-60 gap-1 overflow-y-auto"
            role="listbox"
            aria-label="Processos"
          >
            {(processes.data ?? []).map((option) => (
              <button
                aria-selected={selected?.id === option.id}
                className={`rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
                  selected?.id === option.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-muted'
                }`}
                key={option.id}
                onClick={() => setSelected(option)}
                role="option"
                type="button"
              >
                <span className="font-medium">{option.code}</span> ·{' '}
                {option.clientName}
                <span className="block text-xs text-muted-foreground">
                  {option.housingComplexName ?? 'Sem condomínio'} · cadastro{' '}
                  {formatCivilDate(option.clientRegistrationDate)}
                </span>
              </button>
            ))}
            {processes.data?.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum processo visível encontrado.
              </p>
            ) : null}
          </div>
          {selected && !selected.housingComplexId ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Processo sem condomínio: o cálculo ficará bloqueado até o vínculo.
            </p>
          ) : null}
        </div>
      </FinanceSection>

      <FinanceSection title="Dados do recebimento">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="receipt-kind">Tipo de recebimento</Label>
            <NativeSelect
              id="receipt-kind"
              onChange={(e) => setKind(e.target.value as typeof kind)}
              value={kind}
            >
              {Object.entries(receiptKindLabels).map(([key, label]) => (
                <NativeSelectOption key={key} value={key}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="receipt-amount">Valor bruto (R$)</Label>
            <Input
              id="receipt-amount"
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              placeholder="12.000,00"
              value={amount}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="receipt-release">Data de liberação na conta</Label>
            <Input
              id="receipt-release"
              max={todayCivil()}
              onChange={(e) => setReleaseDate(e.target.value)}
              type="date"
              value={releaseDate}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="receipt-origin">Origem do valor</Label>
            <Input
              id="receipt-origin"
              onChange={(e) => setOriginDescription(e.target.value)}
              placeholder="Ex.: crédito judicial"
              value={originDescription}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="receipt-reference">Referência do depósito</Label>
            <Input
              id="receipt-reference"
              onChange={(e) => setReference(e.target.value)}
              value={reference}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="receipt-description">Observações</Label>
            <Textarea
              id="receipt-description"
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              value={description}
            />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          O comprovante (PDF, JPG ou PNG) é anexado na tela do recebimento,
          depois de salvo.
        </p>
      </FinanceSection>

      <FieldError message={error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          disabled={pending}
          onClick={() => submit(false)}
          variant="outline"
        >
          Salvar rascunho
        </Button>
        <Button disabled={pending} onClick={() => submit(true)}>
          {pending ? 'Salvando…' : 'Salvar e calcular'}
        </Button>
      </div>
    </div>
  )
}
