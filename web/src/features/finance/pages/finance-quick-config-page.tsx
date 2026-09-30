import { useQuery } from '@tanstack/react-query'
import {
  CalendarClock,
  CheckCircle2,
  Eye,
  GitBranch,
  Plus,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
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
} from '../lib/finance-money'
import {
  useCreateRecipient,
  useCreateRule,
  useLinkRecipientUser,
} from '../services/finance.mutations'
import { recipientsQuery, rulesQuery } from '../services/finance.queries'
import type { Recipient, RulePayload } from '../services/finance.service'
import { FinanceConfigPage } from './finance-config-page'

type ParticipantPreset = {
  key: string
  label: string
  description: string
  stage: RulePayload['stage']
  workType: string
}

const PARTICIPANT_PRESETS: ParticipantPreset[] = [
  {
    key: 'LIDERANCA',
    label: 'Liderança',
    description: 'Participação calculada sobre a receita líquida.',
    stage: 'DEDUCAO_LIQUIDA',
    workType: 'Liderança',
  },
  {
    key: 'PROSPECTADOR',
    label: 'Prospectador',
    description: 'Participação calculada sobre a receita líquida.',
    stage: 'DEDUCAO_LIQUIDA',
    workType: 'Prospectador',
  },
  {
    key: 'APOIO',
    label: 'Apoio jurídico-administrativo',
    description: 'Participação calculada sobre a receita líquida.',
    stage: 'DEDUCAO_LIQUIDA',
    workType: 'Apoio jurídico-administrativo',
  },
  {
    key: 'TECNOLOGIA',
    label: 'Tecnologia / participação por período',
    description: 'Útil para casos como Wilamy: início e fim definem quem herda a regra.',
    stage: 'DEDUCAO_LIQUIDA',
    workType: 'Tecnologia',
  },
  {
    key: 'PARCEIRO',
    label: 'Parceiro advogado',
    description: 'Participação sobre o resultado intermediário do motor.',
    stage: 'PARTICIPACAO_RESULTADO',
    workType: 'Parceiro advogado',
  },
  {
    key: 'DISTRIBUICAO_FINAL',
    label: 'Distribuição final',
    description: 'Percentual aplicado ao resultado final a distribuir.',
    stage: 'DISTRIBUICAO_FINAL',
    workType: 'Distribuição final',
  },
]

function ruleScope(rule: { housingComplexes: { name: string }[] }) {
  if (rule.housingComplexes.length === 0) return 'Todos os processos'
  if (rule.housingComplexes.length === 1)
    return rule.housingComplexes[0]?.name ?? '1 condomínio'
  return `${rule.housingComplexes.length} condomínios`
}

function activeParticipantRules(rules: Awaited<ReturnType<typeof rulesQuery>>['queryFn'] extends () => Promise<infer T> ? T : never) {
  return rules.filter(
    (rule) => rule.status === 'ATIVA' && rule.nature === 'CREDITO',
  )
}

/**
 * Visão padrão do administrador: cadastra pessoa + função + percentual uma vez.
 * O modo avançado continua disponível para reservas, provisões e exceções técnicas.
 */
export function FinanceQuickConfigPage() {
  const { permissions } = useSession()
  const [advanced, setAdvanced] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const rules = useQuery(rulesQuery())

  if (advanced) {
    return (
      <div className="grid gap-4">
        <div className="flex justify-end">
          <Button onClick={() => setAdvanced(false)} variant="outline">
            ← Voltar para configuração rápida
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
          description="Somente o administrador altera percentuais e vigências. Sua área de Pagamentos mostra apenas os seus próprios valores."
          eyebrow="Pagamentos"
          title="Configuração financeira"
        />
        <EmptyState
          description="As regras são controladas pelo administrador para preservar histórico e evitar que um usuário veja ou altere os valores de outro."
          icon={ShieldCheck}
          title="Configuração exclusiva do administrador"
        />
      </div>
    )
  }

  const activeRules = rules.data ? activeParticipantRules(rules.data) : []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Cadastre uma pessoa, escolha a função, informe o percentual e a vigência. Marcando todos os processos, o JurisFlow herda essa regra automaticamente sem repetir cadastro processo por processo."
        eyebrow="Pagamentos · Administrador"
        title="Configuração rápida"
      >
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setAdvanced(true)} variant="outline">
            <Settings2 className="size-4" />
            Modo avançado
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            Adicionar participação
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="size-4" />
            Configura uma vez
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Pessoa, função e percentual ficam salvos como regra versionada.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 font-medium">
            <GitBranch className="size-4" />
            Herança automática
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Regra global vale para processos atuais e futuros, independentemente do condomínio.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 font-medium">
            <CalendarClock className="size-4" />
            Histórico preservado
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Períodos permitem representar quem participou e quando saiu sem apagar o passado.
          </p>
        </div>
      </div>

      <FinanceSection
        action={
          <Button onClick={() => setDialogOpen(true)} size="sm">
            <Plus className="size-4" />
            Adicionar
          </Button>
        }
        description="Participações ativas. A ausência de condomínios significa escopo global: todos os processos herdam a regra."
        title="Quem participa do rateio"
      >
        {rules.isPending ? <LoadingState rows={4} /> : null}
        {rules.isError ? (
          <ErrorState error={rules.error} onRetry={() => rules.refetch()} />
        ) : null}
        {!rules.isPending && !rules.isError && activeRules.length === 0 ? (
          <EmptyState
            description="Adicione a primeira participação. Percentuais não são pré-preenchidos: o administrador informa a regra aprovada."
            icon={Users}
            title="Nenhum participante configurado"
          />
        ) : null}
        {activeRules.length > 0 ? (
          <div className="divide-y divide-border rounded-lg border border-border">
            {activeRules.map((rule) => (
              <div
                className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
                key={rule.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {rule.recipientName ?? 'Recebedor'}
                    </span>
                    <StatusBadge tone={rule.housingComplexes.length === 0 ? 'success' : 'info'}>
                      {ruleScope(rule)}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {rule.workType || 'Participação'} · vigência{' '}
                    {formatCivilDate(rule.validFrom)} até{' '}
                    {rule.validTo ? formatCivilDate(rule.validTo) : 'sem data final'}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs text-muted-foreground">Percentual</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatBasisPoints(rule.basisPoints)}
                  </p>
                </div>
                <Button onClick={() => setAdvanced(true)} size="sm" variant="ghost">
                  Editar
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </FinanceSection>

      <FinanceSection
        description="O administrador continua vendo tudo. Usuários vinculados a um recebedor podem consultar somente os próprios créditos; a política geral pode ser exibida por grupos, sem expor quanto o colega recebeu."
        title="Privacidade dos valores"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4" /> Administrador
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Vê e configura todas as regras, créditos e pagamentos.
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Eye className="size-4" /> Usuário
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Vê o desenho dos grupos e somente os valores vinculados à própria conta.
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Users className="size-4" /> Colegas
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Valores individuais de outros recebedores não são retornados pelas consultas protegidas.
            </p>
          </div>
        </div>
      </FinanceSection>

      <QuickParticipantDialog
        onClose={() => setDialogOpen(false)}
        open={dialogOpen}
      />
    </div>
  )
}

function QuickParticipantDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
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
  const [presetKey, setPresetKey] = useState(PARTICIPANT_PRESETS[0]?.key ?? '')
  const [percent, setPercent] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [validTo, setValidTo] = useState('')
  const [applyToAll, setApplyToAll] = useState(true)
  const [userId, setUserId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const pending =
    createRecipient.isPending || createRule.isPending || linkUser.isPending
  const preset =
    PARTICIPANT_PRESETS.find((item) => item.key === presetKey) ??
    PARTICIPANT_PRESETS[0]

  function reset() {
    setName('')
    setKind('PESSOA_FISICA')
    setPresetKey(PARTICIPANT_PRESETS[0]?.key ?? '')
    setPercent('')
    setValidFrom('')
    setValidTo('')
    setApplyToAll(true)
    setUserId('')
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!preset) return setError('Selecione a função.')
    if (!name.trim()) return setError('Informe o nome da pessoa/empresa.')
    const basisPoints = parsePercentToBasisPoints(percent)
    if (basisPoints === null)
      return setError('Informe um percentual válido entre 0 e 100%.')
    if (!validFrom) return setError('Informe quando essa regra começou a valer.')
    if (validTo && validTo < validFrom)
      return setError('A data final não pode ser anterior à data inicial.')
    if (!applyToAll)
      return setError(
        'Para limitar por condomínio, use o Modo avançado. A configuração rápida foi desenhada para herança global.',
      )

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
        stage: preset.stage,
        nature: 'CREDITO',
        recipientId: recipient.id,
        poolLabel: null,
        workType: preset.workType,
        valueType: 'PERCENTUAL',
        basisPoints,
        fixedCents: null,
        sortOrder: 0,
        uniqueness: 'NENHUMA',
        validFrom,
        validTo: validTo || null,
        housingComplexIds: [],
        notes: 'Criada pela configuração rápida do administrador.',
      })

      if (userId) {
        await linkUser.mutateAsync({ recipientId: recipient.id, userId })
      }

      toast.success('Participação configurada para todos os processos.')
      reset()
      onClose()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível salvar a participação.',
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
      title="Adicionar participação"
    >
      <form className="grid gap-4" onSubmit={submit}>
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          Você informa só o que muda no negócio. A etapa matemática e a base de
          cálculo são carregadas pela função escolhida.
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="quick-name">Nome</Label>
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
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="quick-function">Função</Label>
            <NativeSelect
              id="quick-function"
              onChange={(e) => setPresetKey(e.target.value)}
              value={presetKey}
            >
              {PARTICIPANT_PRESETS.map((item) => (
                <NativeSelectOption key={item.key} value={item.key}>
                  {item.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {preset ? (
              <p className="text-xs text-muted-foreground">
                {preset.description}
              </p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="quick-percent">Percentual</Label>
            <Input
              id="quick-percent"
              inputMode="decimal"
              onChange={(e) => setPercent(e.target.value)}
              placeholder="Ex.: 4 ou 2,5"
              value={percent}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="quick-user">Conta do usuário (opcional)</Label>
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
                    {item.name}{item.email ? ` · ${item.email}` : ''}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              Vincular permite que essa pessoa veja o próprio valor sem acessar o dos colegas.
            </p>
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
            <p className="text-xs text-muted-foreground">
              Use para casos como Wilamy: processos cadastrados fora do período não aplicam a participação.
            </p>
          </div>
        </div>

        <label
          className="flex items-start gap-3 rounded-lg border border-border p-4"
          htmlFor="quick-all"
        >
          <Checkbox
            checked={applyToAll}
            id="quick-all"
            onCheckedChange={(checked) => setApplyToAll(checked === true)}
          />
          <span className="grid gap-1 text-sm">
            <span className="font-medium">Aplicar a todos os processos</span>
            <span className="text-xs text-muted-foreground">
              Regra global. Processos atuais e futuros herdam automaticamente; a data de cadastro decide a vigência.
            </span>
          </span>
        </label>

        {!applyToAll ? (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
            Para escolher condomínios específicos, abra o Modo avançado. Isso mantém a configuração rápida simples e evita marcar dezenas de campos sem necessidade.
          </div>
        ) : null}

        <FieldError message={error} />
        <div className="flex justify-end gap-2">
          <Button disabled={pending} onClick={onClose} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button disabled={pending || !applyToAll} type="submit">
            {pending ? 'Salvando…' : 'Salvar e aplicar'}
          </Button>
        </div>
      </form>
    </AppDialog>
  )
}
