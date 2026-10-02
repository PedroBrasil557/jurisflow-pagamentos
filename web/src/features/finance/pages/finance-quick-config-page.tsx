import { useQuery } from '@tanstack/react-query'
import {
  CheckCircle2,
  CircleDollarSign,
  Plus,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import { useSession } from '@/features/auth/hooks/use-session'
import { adminUserListOptions } from '@/features/admin/services/admin-users.queries'
import { AppDialog } from '@/shared/components/app-dialog'
import { PageHeader } from '@/shared/components/page-header'
import { StatusBadge } from '@/shared/components/status-badge'
import {
  EmptyState,
  ErrorState,
  FieldError,
  FinanceSection,
  LoadingState,
} from '../components/finance-ui'
import {
  formatBasisPoints,
  formatCivilDate,
  parsePercentToBasisPoints,
  todayCivil,
} from '../lib/finance-money'
import { rulesEffectiveOn } from '../lib/finance-rules'
import {
  useCreateRecipient,
  useCreateRule,
  useLinkRecipientUser,
} from '../services/finance.mutations'
import { recipientsQuery, rulesQuery } from '../services/finance.queries'
import type { Recipient, Rule } from '../services/finance.service'
import { FinanceConfigPage } from './finance-config-page'

const ONE_HUNDRED_PERCENT_BP = 10_000

function activeRules(rules: Rule[]) {
  return rulesEffectiveOn(rules, todayCivil())
}

function activeGlobalFinalRules(rules: Rule[]) {
  return activeRules(rules).filter(
    (rule) =>
      rule.stage === 'DISTRIBUICAO_FINAL' &&
      rule.nature === 'CREDITO' &&
      rule.housingComplexes.length === 0,
  )
}

function activeGlobalRevenueProvisionRules(rules: Rule[]) {
  return activeRules(rules).filter(
    (rule) =>
      rule.stage === 'PROVISAO_RECEITA' &&
      rule.nature === 'PROVISAO' &&
      rule.housingComplexes.length === 0,
  )
}

function coverageTone(totalBasisPoints: number) {
  if (totalBasisPoints === ONE_HUNDRED_PERCENT_BP) return 'success' as const
  if (totalBasisPoints > ONE_HUNDRED_PERCENT_BP) return 'error' as const
  return 'warning' as const
}

function coverageLabel(totalBasisPoints: number) {
  if (totalBasisPoints === ONE_HUNDRED_PERCENT_BP) return '100% — pronta'
  if (totalBasisPoints > ONE_HUNDRED_PERCENT_BP)
    return `${formatBasisPoints(totalBasisPoints)} — acima de 100%`
  return `${formatBasisPoints(totalBasisPoints)} — pendente`
}

/**
 * Configuração padrão do administrador.
 * A interface mostra somente o necessário para o uso diário:
 * 1) provisão inicial (pode ser 0%);
 * 2) destinos da distribuição final;
 * 3) aplicação global por padrão;
 * 4) conferência de 100%.
 * O motor/versionamento continuam intactos no modo avançado.
 */
export function FinanceQuickConfigPage() {
  const { permissions } = useSession()
  const [advanced, setAdvanced] = useState(false)
  const [participantOpen, setParticipantOpen] = useState(false)
  const [provisionOpen, setProvisionOpen] = useState(false)
  const rules = useQuery(rulesQuery())

  if (advanced) {
    return (
      <div className="grid gap-4">
        <div className="flex justify-end">
          <Button onClick={() => setAdvanced(false)} variant="outline">
            ← Voltar para configuração simples
          </Button>
        </div>
        <FinanceConfigPage />
      </div>
    )
  }

  if (!permissions.isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          description="Somente o administrador altera a distribuição financeira."
          eyebrow="Pagamentos"
          title="Configuração de pagamentos"
        />
        <EmptyState
          description="As regras ficam protegidas para preservar histórico e evitar alterações indevidas."
          icon={ShieldCheck}
          title="Configuração exclusiva do administrador"
        />
      </div>
    )
  }

  const allRules = rules.data ?? []
  const finalRules = activeGlobalFinalRules(allRules)
  const provisionRules = activeGlobalRevenueProvisionRules(allRules)
  const finalBasisPoints = finalRules.reduce(
    (total, rule) => total + (rule.basisPoints ?? 0),
    0,
  )
  const missingBasisPoints = ONE_HUNDRED_PERCENT_BP - finalBasisPoints
  const hasProvision = provisionRules.length > 0
  const isReady = hasProvision && finalBasisPoints === ONE_HUNDRED_PERCENT_BP
  const scopedRules = activeRules(allRules).filter(
    (rule) => rule.housingComplexes.length > 0,
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Defina uma vez como o dinheiro deve ser tratado. A configuração fica pronta quando a provisão estiver definida e a distribuição final somar exatamente 100%."
        eyebrow="Pagamentos · Administrador"
        title="Configuração de pagamentos"
      >
        <Button onClick={() => setAdvanced(true)} variant="outline">
          <Settings2 className="size-4" />
          Opções avançadas
        </Button>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SetupStep
          done={hasProvision}
          number="1"
          title="Entrada"
          description={
            hasProvision ? 'Provisão definida' : 'Defina a provisão, mesmo que seja 0%'
          }
        />
        <SetupStep
          done={finalRules.length > 0}
          number="2"
          title="Quem recebe"
          description={
            finalRules.length > 0
              ? `${finalRules.length} destino(s) configurado(s)`
              : 'Adicione os destinos do dinheiro'
          }
        />
        <SetupStep
          done={finalBasisPoints === ONE_HUNDRED_PERCENT_BP}
          number="3"
          title="Percentuais"
          description={coverageLabel(finalBasisPoints)}
        />
        <SetupStep
          done={isReady}
          number="4"
          title="Conferência"
          description={isReady ? 'Configuração pronta para uso' : 'Ainda há pendência'}
        />
      </div>

      <FinanceSection
        action={
          hasProvision ? (
            <Button onClick={() => setAdvanced(true)} size="sm" variant="outline">
              Editar
            </Button>
          ) : (
            <Button onClick={() => setProvisionOpen(true)} size="sm">
              Configurar
            </Button>
          )
        }
        description="A provisão é definida antes da distribuição. Se não existir retenção, o administrador registra 0% de forma explícita."
        title="1. Entrada do dinheiro"
      >
        {rules.isPending ? <LoadingState rows={1} /> : null}
        {rules.isError ? (
          <ErrorState error={rules.error} onRetry={() => rules.refetch()} />
        ) : null}
        {!rules.isPending && !rules.isError ? (
          hasProvision ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
              <div>
                <p className="font-medium">Provisão configurada</p>
                <p className="text-sm text-muted-foreground">
                  {provisionRules
                    .map((rule) =>
                      rule.valueType === 'PERCENTUAL'
                        ? `${rule.poolLabel ?? 'Provisão'} · ${formatBasisPoints(rule.basisPoints ?? 0)}`
                        : rule.poolLabel ?? 'Provisão',
                    )
                    .join(' · ')}
                </p>
              </div>
              <StatusBadge tone="success">Definida</StatusBadge>
            </div>
          ) : (
            <EmptyState
              description="Informe a provisão inicial. Se não houver nenhuma retenção, salve 0%."
              icon={CircleDollarSign}
              title="Falta definir a provisão"
            />
          )
        ) : null}
      </FinanceSection>

      <FinanceSection
        action={
          <Button onClick={() => setParticipantOpen(true)} size="sm">
            <Plus className="size-4" />
            Adicionar destino
          </Button>
        }
        description="Aqui fica a regra simples: o saldo final precisa ser distribuído integralmente."
        title="2. Distribuição final"
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
          <div>
            {finalRules.length === 0 ? (
              <EmptyState
                description="Cadastre quem recebe e qual percentual cabe a cada pessoa ou empresa."
                icon={Users}
                title="Nenhum destino configurado"
              />
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {finalRules.map((rule) => (
                  <div
                    className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    key={rule.id}
                  >
                    <div>
                      <p className="font-medium">
                        {rule.recipientName ?? 'Recebedor'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {rule.workType || 'Distribuição'} · válido desde{' '}
                        {formatCivilDate(rule.validFrom)}
                        {rule.validTo
                          ? ` até ${formatCivilDate(rule.validTo)}`
                          : ''}
                      </p>
                    </div>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatBasisPoints(rule.basisPoints ?? 0)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col justify-center gap-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Configurado</span>
              <span className="text-2xl font-bold tabular-nums">
                {formatBasisPoints(finalBasisPoints)}
              </span>
            </div>
            <StatusBadge tone={coverageTone(finalBasisPoints)}>
              {coverageLabel(finalBasisPoints)}
            </StatusBadge>
            {missingBasisPoints > 0 ? (
              <p className="text-sm text-muted-foreground">
                Faltam {formatBasisPoints(missingBasisPoints)} para completar a distribuição.
              </p>
            ) : null}
            {missingBasisPoints < 0 ? (
              <p className="text-sm text-destructive">
                A distribuição excede 100% em {formatBasisPoints(Math.abs(missingBasisPoints))}.
              </p>
            ) : null}
          </div>
        </div>
      </FinanceSection>

      <FinanceSection
        description="A configuração simples vale para todos os processos. Exceções por condomínio continuam disponíveis, mas ficam fora do fluxo principal."
        title="3. Onde a regra vale"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
          <div>
            <p className="font-medium">Todos os processos</p>
            <p className="text-sm text-muted-foreground">
              Novas entradas usam automaticamente a configuração global vigente.
            </p>
          </div>
          <Button onClick={() => setAdvanced(true)} variant="outline">
            Configurar exceções
          </Button>
        </div>
        {scopedRules.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Existem {scopedRules.length} regra(s) específica(s) por condomínio no modo avançado.
          </p>
        ) : null}
      </FinanceSection>

      <FinanceSection
        description="O usuário não precisa interpretar o motor: a configuração só é considerada pronta quando os requisitos mínimos estiverem completos."
        title="4. Conferência"
      >
        <div
          className={`flex items-start gap-3 rounded-lg border p-4 ${
            isReady
              ? 'border-emerald-500/35 bg-emerald-500/10'
              : 'border-amber-500/35 bg-amber-500/10'
          }`}
        >
          {isReady ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          ) : (
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
          )}
          <div className="grid gap-1">
            <p className="font-semibold">
              {isReady ? 'Configuração pronta' : 'Configuração pendente'}
            </p>
            <p className="text-sm text-muted-foreground">
              {isReady
                ? 'A provisão está definida e a distribuição final fecha exatamente em 100%.'
                : [
                    !hasProvision ? 'Falta definir a provisão inicial.' : null,
                    finalBasisPoints < ONE_HUNDRED_PERCENT_BP
                      ? `Faltam ${formatBasisPoints(ONE_HUNDRED_PERCENT_BP - finalBasisPoints)} na distribuição final.`
                      : null,
                    finalBasisPoints > ONE_HUNDRED_PERCENT_BP
                      ? `A distribuição ultrapassa 100% em ${formatBasisPoints(finalBasisPoints - ONE_HUNDRED_PERCENT_BP)}.`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
            </p>
          </div>
        </div>
      </FinanceSection>

      <ProvisionDialog
        onClose={() => setProvisionOpen(false)}
        open={provisionOpen}
      />
      <QuickParticipantDialog
        currentBasisPoints={finalBasisPoints}
        onClose={() => setParticipantOpen(false)}
        open={participantOpen}
      />
    </div>
  )
}

function SetupStep({
  number,
  title,
  description,
  done,
}: {
  number: string
  title: string
  description: string
  done: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span
          className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${
            done
              ? 'bg-emerald-500/15 text-emerald-600'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {done ? '✓' : number}
        </span>
        <span className="font-medium">{title}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function ProvisionDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const createRule = useCreateRule()
  const [percent, setPercent] = useState('0')
  const [validFrom, setValidFrom] = useState('')
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setPercent('0')
    setValidFrom('')
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const basisPoints = parsePercentToBasisPoints(percent)
    if (basisPoints === null)
      return setError('Informe um percentual válido entre 0 e 100%.')
    if (!validFrom)
      return setError('Informe quando essa configuração começa a valer.')

    try {
      await createRule.mutateAsync({
        stage: 'PROVISAO_RECEITA',
        nature: 'PROVISAO',
        recipientId: null,
        poolLabel: 'Provisão sobre receita',
        workType: 'Provisão sobre receita',
        valueType: 'PERCENTUAL',
        basisPoints,
        fixedCents: null,
        sortOrder: 0,
        uniqueness: 'NENHUMA',
        validFrom,
        validTo: null,
        housingComplexIds: [],
        notes: 'Criada pela configuração simples do administrador.',
      })
      toast.success('Provisão inicial configurada.')
      reset()
      onClose()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível salvar a provisão.',
      )
    }
  }

  return (
    <AppDialog
      icon={CircleDollarSign}
      maxWidth="md"
      onClose={() => {
        if (!createRule.isPending) onClose()
      }}
      open={open}
      title="Definir provisão inicial"
    >
      <form className="grid gap-4" onSubmit={submit}>
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          Se não houver retenção sobre a entrada, mantenha 0%. O importante é deixar essa decisão registrada.
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="provision-percent">Percentual</Label>
          <Input
            autoFocus
            id="provision-percent"
            inputMode="decimal"
            onChange={(e) => setPercent(e.target.value)}
            placeholder="Ex.: 0 ou 10"
            value={percent}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="provision-from">Válido desde</Label>
          <Input
            id="provision-from"
            onChange={(e) => setValidFrom(e.target.value)}
            type="date"
            value={validFrom}
          />
        </div>
        <FieldError message={error} />
        <div className="flex justify-end gap-2">
          <Button
            disabled={createRule.isPending}
            onClick={onClose}
            type="button"
            variant="ghost"
          >
            Cancelar
          </Button>
          <Button disabled={createRule.isPending} type="submit">
            {createRule.isPending ? 'Salvando…' : 'Salvar provisão'}
          </Button>
        </div>
      </form>
    </AppDialog>
  )
}

function QuickParticipantDialog({
  open,
  onClose,
  currentBasisPoints,
}: {
  open: boolean
  onClose: () => void
  currentBasisPoints: number
}) {
  const recipients = useQuery(recipientsQuery())
  const users = useQuery({
    ...adminUserListOptions({ limit: 100, page: 1 }),
    enabled: open,
  })
  const createRecipient = useCreateRecipient()
  const createRule = useCreateRule()
  const linkUser = useLinkRecipientUser()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'PESSOA_FISICA' | 'PESSOA_JURIDICA'>(
    'PESSOA_FISICA',
  )
  const [workType, setWorkType] = useState('')
  const [percent, setPercent] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [validTo, setValidTo] = useState('')
  const [userId, setUserId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const pending =
    createRecipient.isPending || createRule.isPending || linkUser.isPending

  function reset() {
    setName('')
    setKind('PESSOA_FISICA')
    setWorkType('')
    setPercent('')
    setValidFrom('')
    setValidTo('')
    setUserId('')
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Informe quem recebe.')
    const basisPoints = parsePercentToBasisPoints(percent)
    if (basisPoints === null)
      return setError('Informe um percentual válido entre 0 e 100%.')
    if (currentBasisPoints + basisPoints > ONE_HUNDRED_PERCENT_BP)
      return setError(
        `Esse percentual faria a distribuição ultrapassar 100%. Restam ${formatBasisPoints(Math.max(0, ONE_HUNDRED_PERCENT_BP - currentBasisPoints))}.`,
      )
    if (!validFrom)
      return setError('Informe quando essa regra começa a valer.')
    if (validTo && validTo < validFrom)
      return setError('A data final não pode ser anterior à data inicial.')

    try {
      const existing = (recipients.data ?? []).find(
        (recipient) =>
          recipient.name.trim().toLocaleLowerCase('pt-BR') ===
          name.trim().toLocaleLowerCase('pt-BR'),
      )
      let recipient: Pick<Recipient, 'id'> | undefined = existing
      if (!recipient) {
        const created = (await createRecipient.mutateAsync({
          name: name.trim(),
          kind,
        })) as { recipient?: Pick<Recipient, 'id'> }
        recipient = created.recipient
      }
      if (!recipient?.id) {
        throw new Error('O recebedor foi salvo, mas o identificador não retornou.')
      }

      await createRule.mutateAsync({
        stage: 'DISTRIBUICAO_FINAL',
        nature: 'CREDITO',
        recipientId: recipient.id,
        poolLabel: null,
        workType: workType.trim() || 'Distribuição final',
        valueType: 'PERCENTUAL',
        basisPoints,
        fixedCents: null,
        sortOrder: 0,
        uniqueness: 'NENHUMA',
        validFrom,
        validTo: validTo || null,
        housingComplexIds: [],
        notes: 'Criada pela configuração simples do administrador.',
      })

      if (userId) {
        await linkUser.mutateAsync({ recipientId: recipient.id, userId })
      }

      toast.success('Destino adicionado à distribuição.')
      reset()
      onClose()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível salvar o destino.',
      )
    }
  }

  return (
    <AppDialog
      icon={Plus}
      maxWidth="lg"
      onClose={() => {
        if (!pending) onClose()
      }}
      open={open}
      title="Adicionar destino"
    >
      <form className="grid gap-4" onSubmit={submit}>
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          Informe apenas quem recebe e quanto recebe. O JurisFlow mantém o cálculo, o histórico e o versionamento nos bastidores.
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="quick-name">Quem recebe</Label>
            <Input
              autoFocus
              id="quick-name"
              onChange={(e) => setName(e.target.value)}
              placeholder="Pessoa ou empresa"
              value={name}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="quick-kind">Tipo</Label>
            <NativeSelect
              id="quick-kind"
              onChange={(e) => setKind(e.target.value as typeof kind)}
              value={kind}
            >
              <NativeSelectOption value="PESSOA_FISICA">Pessoa física</NativeSelectOption>
              <NativeSelectOption value="PESSOA_JURIDICA">Pessoa jurídica</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="quick-percent">Percentual</Label>
            <Input
              id="quick-percent"
              inputMode="decimal"
              onChange={(e) => setPercent(e.target.value)}
              placeholder="Ex.: 20 ou 12,5"
              value={percent}
            />
            <p className="text-xs text-muted-foreground">
              Disponível: {formatBasisPoints(Math.max(0, ONE_HUNDRED_PERCENT_BP - currentBasisPoints))}
            </p>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="quick-work">Função/descrição (opcional)</Label>
            <Input
              id="quick-work"
              onChange={(e) => setWorkType(e.target.value)}
              placeholder="Ex.: escritório, parceiro, colaborador"
              value={workType}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="quick-from">Válido desde</Label>
            <Input
              id="quick-from"
              onChange={(e) => setValidFrom(e.target.value)}
              type="date"
              value={validFrom}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="quick-to">Válido até (opcional)</Label>
            <Input
              id="quick-to"
              onChange={(e) => setValidTo(e.target.value)}
              type="date"
              value={validTo}
            />
          </div>
        </div>

        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Vincular conta de usuário (opcional)
          </summary>
          <div className="mt-3 grid gap-1.5">
            <Label htmlFor="quick-user">Conta</Label>
            <NativeSelect
              id="quick-user"
              onChange={(e) => setUserId(e.target.value)}
              value={userId}
            >
              <NativeSelectOption value="">Não vincular agora</NativeSelectOption>
              {(users.data?.items ?? [])
                .filter((item) => item.isActive)
                .map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.name}
                    {item.email ? ` · ${item.email}` : ''}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </div>
        </details>

        <FieldError message={error} />
        <div className="flex justify-end gap-2">
          <Button
            disabled={pending}
            onClick={onClose}
            type="button"
            variant="ghost"
          >
            Cancelar
          </Button>
          <Button disabled={pending} type="submit">
            {pending ? 'Salvando…' : 'Salvar destino'}
          </Button>
        </div>
      </form>
    </AppDialog>
  )
}
