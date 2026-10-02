import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Ban,
  FileClock,
  FileSpreadsheet,
  GitBranch,
  History,
  Pencil,
  Plus,
  UserMinus,
  UserPlus,
  UserRoundCheck,
  Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import { Textarea } from '#/components/ui/textarea'
import { useSession } from '@/features/auth/hooks/use-session'
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
import { RuleForm } from '../components/rule-form'
import {
  formatBasisPoints,
  formatCents,
  formatCivilDate,
  todayCivil,
} from '../lib/finance-money'
import { rulesEffectiveOn } from '../lib/finance-rules'
import {
  financeAccess,
  natureLabels,
  stageLabels,
} from '../lib/finance-labels'
import {
  useCreateRecipient,
  useCreateRuleVersion,
  useRevokeRule,
  useUpdateRecipient,
} from '../services/finance.mutations'
import { recipientsQuery, rulesQuery } from '../services/finance.queries'
import type { Recipient, Rule } from '../services/finance.service'

type AdvancedTab = 'regras' | 'recebedores' | 'importacao' | 'historico'
type RuleFilter =
  | 'TODAS'
  | 'PROVISAO_RECEITA'
  | 'DEDUCAO_LIQUIDA'
  | 'RESERVA'
  | 'PARTICIPACAO_RESULTADO'
  | 'DISTRIBUICAO_FINAL'

const tabs: Array<{
  id: AdvancedTab
  label: string
  description: string
}> = [
  {
    id: 'regras',
    label: 'Regras especiais',
    description: 'Exceções, reservas, deduções e participações.',
  },
  {
    id: 'recebedores',
    label: 'Recebedores',
    description: 'Pessoas e empresas que podem receber valores.',
  },
  {
    id: 'importacao',
    label: 'Importação',
    description: 'Carga em lote por planilha.',
  },
  {
    id: 'historico',
    label: 'Histórico',
    description: 'Versões, vigências e regras revogadas.',
  },
]

const filters: Array<{ id: RuleFilter; label: string }> = [
  { id: 'TODAS', label: 'Todas' },
  { id: 'PROVISAO_RECEITA', label: 'Provisões' },
  { id: 'DEDUCAO_LIQUIDA', label: 'Deduções' },
  { id: 'RESERVA', label: 'Reservas' },
  { id: 'PARTICIPACAO_RESULTADO', label: 'Participações' },
  { id: 'DISTRIBUICAO_FINAL', label: 'Distribuição final' },
]

function ruleValue(rule: Rule) {
  return rule.valueType === 'VALOR_FIXO'
    ? rule.fixedCents === null
      ? 'não configurado'
      : formatCents(rule.fixedCents)
    : formatBasisPoints(rule.basisPoints)
}

function scopeLabel(rule: Rule) {
  if (rule.housingComplexes.length === 0) return 'Todos os condomínios'
  return rule.housingComplexes.map((complex) => complex.name).join(', ')
}

function ruleTitle(rule: Rule) {
  return rule.recipientName ?? rule.poolLabel ?? 'Regra sem nome'
}

/**
 * Configurações avançadas do Financeiro.
 * Esta área existe para exceções e manutenção técnica da configuração;
 * o fluxo principal continua em "Gerenciar regras".
 */
export function FinanceConfigPage() {
  const { permissions } = useSession()
  const canEdit = financeAccess.regras(permissions)
  const recipients = useQuery(recipientsQuery())
  const rules = useQuery(rulesQuery())
  const [tab, setTab] = useState<AdvancedTab>('regras')
  const [filter, setFilter] = useState<RuleFilter>('TODAS')
  const [recipientOpen, setRecipientOpen] = useState(false)
  const [editingRecipient, setEditingRecipient] = useState<Recipient | null>(null)
  const [togglingRecipient, setTogglingRecipient] = useState<Recipient | null>(null)
  const [versionOf, setVersionOf] = useState<Rule | null>(null)
  const [revoking, setRevoking] = useState<Rule | null>(null)
  const [historyLineageId, setHistoryLineageId] = useState<string | null>(null)

  const allRules = rules.data ?? []
  const activeRules = rulesEffectiveOn(allRules, todayCivil())
  const specialRules = activeRules.filter(
    (rule) =>
      !(
        rule.housingComplexes.length === 0 &&
        (rule.stage === 'PROVISAO_RECEITA' ||
          rule.stage === 'DISTRIBUICAO_FINAL')
      ),
  )
  const visibleRules =
    filter === 'TODAS'
      ? specialRules
      : specialRules.filter((rule) => rule.stage === filter)

  const historyGroups = useMemo(() => {
    const groups = new Map<string, Rule[]>()
    for (const rule of allRules) {
      const current = groups.get(rule.lineageId) ?? []
      current.push(rule)
      groups.set(rule.lineageId, current)
    }

    return Array.from(groups.entries())
      .map(([lineageId, versions]) => ({
        lineageId,
        versions: [...versions].sort((a, b) => b.version - a.version),
      }))
      .filter((group) =>
        historyLineageId ? group.lineageId === historyLineageId : true,
      )
      .sort((a, b) =>
        ruleTitle(a.versions[0]).localeCompare(ruleTitle(b.versions[0]), 'pt-BR'),
      )
  }, [allRules, historyLineageId])

  const isEmpty = recipients.data?.length === 0 && allRules.length === 0

  function openHistory(rule: Rule) {
    setHistoryLineageId(rule.lineageId)
    setTab('historico')
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Use esta área para exceções, regras especiais, importações e manutenção do histórico. A configuração principal continua em Gerenciar regras."
        eyebrow="Financeiro · Opções avançadas"
        title="Configurações avançadas"
      />

      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-sm font-medium">Área para casos especiais</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Para alterar a provisão padrão, os destinos principais, os percentuais
          ou o alcance da regra, volte para a configuração simples. Aqui ficam
          somente exceções e ferramentas administrativas.
        </p>
      </div>

      <nav
        aria-label="Seções das configurações avançadas"
        className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
      >
        {tabs.map((item) => {
          const active = item.id === tab
          return (
            <button
              aria-current={active ? 'page' : undefined}
              className={`rounded-lg border p-4 text-left transition-colors ${
                active
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/50'
              }`}
              key={item.id}
              onClick={() => {
                setTab(item.id)
                if (item.id !== 'historico') setHistoryLineageId(null)
              }}
              type="button"
            >
              <span className="block text-sm font-semibold">{item.label}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {item.description}
              </span>
            </button>
          )
        })}
      </nav>

      {recipients.isPending || rules.isPending ? <LoadingState /> : null}
      {recipients.isError ? (
        <ErrorState
          error={recipients.error}
          onRetry={() => recipients.refetch()}
        />
      ) : null}
      {rules.isError ? (
        <ErrorState error={rules.error} onRetry={() => rules.refetch()} />
      ) : null}

      {isEmpty ? (
        <EmptyState
          description="Ainda não existem recebedores ou regras. Comece pela configuração simples do Financeiro e volte aqui quando precisar de uma exceção."
          title="Nenhuma configuração cadastrada"
        />
      ) : null}

      {!rules.isPending && !rules.isError && tab === 'regras' ? (
        <FinanceSection
          action={
            canEdit ? (
              <Button asChild>
                <Link
                  className="no-underline"
                  preload={false}
                  to="/pagamentos/configuracao/novo"
                >
                  <Plus className="size-4" />
                  Nova regra especial
                </Link>
              </Button>
            ) : undefined
          }
          description="Mostra regras ativas fora da configuração principal: exceções por condomínio, reservas, deduções e participações. Provisão e distribuição globais continuam em Gerenciar regras."
          title="Regras especiais"
        >
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              {filters.map((item) => (
                <Button
                  key={item.id}
                  onClick={() => setFilter(item.id)}
                  size="sm"
                  variant={filter === item.id ? 'default' : 'outline'}
                >
                  {item.label}
                </Button>
              ))}
            </div>

            {visibleRules.length === 0 ? (
              <EmptyState
                description="Não há regras ativas neste filtro."
                title="Nenhuma regra encontrada"
              />
            ) : (
              <div className="grid gap-3">
                {visibleRules.map((rule) => (
                  <article
                    className="grid gap-4 rounded-lg border border-border p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                    key={rule.id}
                  >
                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{ruleTitle(rule)}</h3>
                        <StatusBadge tone="success">Ativa</StatusBadge>
                        <StatusBadge tone="ghost">
                          {stageLabels[rule.stage]?.label ?? rule.stage}
                        </StatusBadge>
                      </div>

                      <div className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                        <RuleFact label="Valor" value={ruleValue(rule)} />
                        <RuleFact
                          label="Finalidade"
                          value={
                            rule.workType ||
                            natureLabels[rule.nature] ||
                            'Não informada'
                          }
                        />
                        <RuleFact label="Onde vale" value={scopeLabel(rule)} />
                        <RuleFact
                          label="Vigência"
                          value={`${formatCivilDate(rule.validFrom)}${
                            rule.validTo
                              ? ` até ${formatCivilDate(rule.validTo)}`
                              : ' em diante'
                          }`}
                        />
                      </div>
                    </div>

                    {canEdit ? (
                      <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                        <Button
                          onClick={() => setVersionOf(rule)}
                          size="sm"
                          variant="outline"
                        >
                          <GitBranch className="size-4" />
                          Editar
                        </Button>
                        <Button
                          onClick={() => openHistory(rule)}
                          size="sm"
                          variant="ghost"
                        >
                          <History className="size-4" />
                          Histórico
                        </Button>
                        <Button
                          onClick={() => setRevoking(rule)}
                          size="sm"
                          variant="ghost"
                        >
                          <Ban className="size-4" />
                          Revogar
                        </Button>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </FinanceSection>
      ) : null}

      {!recipients.isPending && !recipients.isError && tab === 'recebedores' ? (
        <FinanceSection
          action={
            canEdit ? (
              <Button onClick={() => setRecipientOpen(true)}>
                <UserPlus className="size-4" />
                Adicionar recebedor
              </Button>
            ) : undefined
          }
          description="Cadastre as pessoas e empresas que podem aparecer como destino de uma regra."
          title="Recebedores"
        >
          {recipients.data?.length === 0 ? (
            <EmptyState
              description="Cadastre o primeiro recebedor para usá-lo em regras de pagamento."
              icon={Users}
              title="Nenhum recebedor cadastrado"
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {(recipients.data ?? []).map((recipient) => (
                <article
                  className="rounded-lg border border-border p-4"
                  key={recipient.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{recipient.name}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {recipient.kind === 'PESSOA_JURIDICA'
                          ? 'Pessoa jurídica'
                          : 'Pessoa física'}
                        {recipient.document ? ` · ${recipient.document}` : ''}
                      </p>
                    </div>
                    <StatusBadge tone={recipient.isActive ? 'success' : 'ghost'}>
                      {recipient.isActive ? 'Ativo' : 'Inativo'}
                    </StatusBadge>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {recipient.paymentNote || 'Sem dados de pagamento informados.'}
                  </p>
                  {recipient.origin === 'IMPORTACAO' ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Cadastro criado por importação.
                    </p>
                  ) : null}
                  {canEdit ? (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                      <Button
                        onClick={() => setEditingRecipient(recipient)}
                        size="sm"
                        variant="outline"
                      >
                        <Pencil className="size-4" />
                        Editar
                      </Button>
                      <Button
                        onClick={() => setTogglingRecipient(recipient)}
                        size="sm"
                        variant="ghost"
                      >
                        {recipient.isActive ? (
                          <UserMinus className="size-4" />
                        ) : (
                          <UserRoundCheck className="size-4" />
                        )}
                        {recipient.isActive ? 'Desativar' : 'Reativar'}
                      </Button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </FinanceSection>
      ) : null}

      {tab === 'importacao' ? (
        <FinanceSection
          description="Use a importação somente quando houver muitos recebedores ou regras para cadastrar de uma vez."
          title="Importação por planilha"
        >
          <div className="grid gap-4 rounded-lg border border-border p-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
            <div className="flex size-10 items-center justify-center rounded-md bg-muted">
              <FileSpreadsheet className="size-5" />
            </div>
            <div>
              <p className="font-medium">Importar configuração em lote</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Revise o arquivo antes de confirmar. A importação alimenta a
                mesma estrutura usada pelo cadastro manual e continua sujeita
                às validações do Financeiro.
              </p>
            </div>
            {financeAccess.importar(permissions) ? (
              <Button asChild variant="outline">
                <Link
                  className="no-underline"
                  preload={false}
                  to="/pagamentos/configuracao/importar"
                >
                  <FileSpreadsheet className="size-4" />
                  Abrir importação
                </Link>
              </Button>
            ) : null}
          </div>
        </FinanceSection>
      ) : null}

      {!rules.isPending && !rules.isError && tab === 'historico' ? (
        <FinanceSection
          action={
            historyLineageId ? (
              <Button
                onClick={() => setHistoryLineageId(null)}
                size="sm"
                variant="outline"
              >
                Ver todas
              </Button>
            ) : undefined
          }
          description="Cada alteração relevante cria uma nova versão. Fechamentos antigos continuam ligados à versão usada no momento do cálculo."
          title="Histórico de regras"
        >
          {historyGroups.length === 0 ? (
            <EmptyState
              description="Ainda não existem versões de regras para consultar."
              icon={FileClock}
              title="Histórico vazio"
            />
          ) : (
            <div className="grid gap-4">
              {historyGroups.map((group) => {
                const current = group.versions[0]
                return (
                  <article
                    className="overflow-hidden rounded-lg border border-border"
                    key={group.lineageId}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
                      <div>
                        <h3 className="font-semibold">{ruleTitle(current)}</h3>
                        <p className="text-xs text-muted-foreground">
                          {stageLabels[current.stage]?.label ?? current.stage}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {group.versions.length} versão(ões)
                      </span>
                    </div>

                    <div className="divide-y divide-border">
                      {group.versions.map((version, index) => {
                        const revoked = version.status === 'REVOGADA'
                        const versionLabel = revoked
                          ? 'Revogada'
                          : index === 0
                            ? 'Atual'
                            : 'Anterior'

                        return (
                          <div
                            className="grid gap-3 px-4 py-3 sm:grid-cols-[80px_minmax(0,1fr)_auto] sm:items-center"
                            key={version.id}
                          >
                            <div>
                              <p className="text-sm font-semibold">
                                v{version.version}
                              </p>
                              <StatusBadge
                                tone={
                                  revoked
                                    ? 'ghost'
                                    : index === 0
                                      ? 'success'
                                      : 'info'
                                }
                              >
                                {versionLabel}
                              </StatusBadge>
                            </div>
                            <div className="grid gap-1 text-sm">
                              <p>
                                <span className="text-muted-foreground">Valor: </span>
                                <strong>{ruleValue(version)}</strong>
                              </p>
                              <p className="text-muted-foreground">
                                {scopeLabel(version)}
                              </p>
                            </div>
                            <div className="text-sm text-muted-foreground sm:text-right">
                              {formatCivilDate(version.validFrom)}
                              {version.validTo
                                ? ` → ${formatCivilDate(version.validTo)}`
                                : revoked
                                  ? ' → revogada'
                                  : ' → atual'}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </FinanceSection>
      ) : null}

      <RecipientDialog
        onClose={() => setRecipientOpen(false)}
        open={recipientOpen}
      />
      {editingRecipient ? (
        <EditRecipientDialog
          onClose={() => setEditingRecipient(null)}
          recipient={editingRecipient}
        />
      ) : null}
      {togglingRecipient ? (
        <RecipientStatusDialog
          onClose={() => setTogglingRecipient(null)}
          recipient={togglingRecipient}
        />
      ) : null}
      {versionOf ? (
        <VersionDialog onClose={() => setVersionOf(null)} rule={versionOf} />
      ) : null}
      {revoking ? (
        <RevokeDialog onClose={() => setRevoking(null)} rule={revoking} />
      ) : null}
    </div>
  )
}

function RuleFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1">{value}</p>
    </div>
  )
}

function RecipientDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const mutation = useCreateRecipient()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'PESSOA_FISICA' | 'PESSOA_JURIDICA'>(
    'PESSOA_FISICA',
  )
  const [document, setDocument] = useState('')
  const [paymentNote, setPaymentNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return setError('Informe o nome.')
    mutation.mutate(
      {
        name,
        kind,
        document: document || undefined,
        paymentNote: paymentNote || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Recebedor cadastrado.')
          setName('')
          setDocument('')
          setPaymentNote('')
          onClose()
        },
        onError: (cause) => setError((cause as Error).message),
      },
    )
  }
  return (
    <AppDialog
      icon={UserPlus}
      maxWidth="md"
      onClose={onClose}
      open={open}
      title="Adicionar recebedor"
    >
      <form className="grid gap-3" onSubmit={submit}>
        <div className="grid gap-1.5">
          <Label htmlFor="recipient-name">Nome</Label>
          <Input
            autoFocus
            id="recipient-name"
            onChange={(e) => setName(e.target.value)}
            value={name}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="recipient-kind">Tipo de pessoa</Label>
          <NativeSelect
            id="recipient-kind"
            onChange={(e) => setKind(e.target.value as typeof kind)}
            value={kind}
          >
            <NativeSelectOption value="PESSOA_FISICA">
              Pessoa física
            </NativeSelectOption>
            <NativeSelectOption value="PESSOA_JURIDICA">
              Pessoa jurídica
            </NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="recipient-doc">CPF/CNPJ (opcional)</Label>
          <Input
            id="recipient-doc"
            inputMode="numeric"
            onChange={(e) => setDocument(e.target.value)}
            value={document}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="recipient-payment">
            Dados para pagamento (informativo)
          </Label>
          <Textarea
            id="recipient-payment"
            onChange={(e) => setPaymentNote(e.target.value)}
            rows={2}
            value={paymentNote}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Nomes parecidos não são unidos: cada cadastro é uma identidade própria.
        </p>
        <FieldError message={error} />
        <div className="flex justify-end">
          <Button disabled={mutation.isPending} type="submit">
            Salvar
          </Button>
        </div>
      </form>
    </AppDialog>
  )
}

function EditRecipientDialog({
  recipient,
  onClose,
}: {
  recipient: Recipient
  onClose: () => void
}) {
  const mutation = useUpdateRecipient()
  const [name, setName] = useState(recipient.name)
  const [kind, setKind] = useState(recipient.kind)
  const [document, setDocument] = useState(recipient.document ?? '')
  const [paymentNote, setPaymentNote] = useState(recipient.paymentNote ?? '')
  const [error, setError] = useState<string | null>(null)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Informe o nome.')
    mutation.mutate(
      {
        id: recipient.id,
        payload: {
          name: name.trim(),
          kind,
          document,
          paymentNote,
        },
      },
      {
        onSuccess: () => {
          toast.success('Recebedor atualizado.')
          onClose()
        },
        onError: (cause) => setError((cause as Error).message),
      },
    )
  }

  return (
    <AppDialog
      icon={Pencil}
      maxWidth="md"
      onClose={onClose}
      open
      title={`Editar recebedor — ${recipient.name}`}
    >
      <form className="grid gap-3" onSubmit={submit}>
        <div className="grid gap-1.5">
          <Label htmlFor="edit-recipient-name">Nome</Label>
          <Input
            autoFocus
            id="edit-recipient-name"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="edit-recipient-kind">Tipo de pessoa</Label>
          <NativeSelect
            id="edit-recipient-kind"
            onChange={(event) =>
              setKind(event.target.value as typeof recipient.kind)
            }
            value={kind}
          >
            <NativeSelectOption value="PESSOA_FISICA">
              Pessoa física
            </NativeSelectOption>
            <NativeSelectOption value="PESSOA_JURIDICA">
              Pessoa jurídica
            </NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="edit-recipient-doc">CPF/CNPJ (opcional)</Label>
          <Input
            id="edit-recipient-doc"
            inputMode="numeric"
            onChange={(event) => setDocument(event.target.value)}
            value={document}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="edit-recipient-payment">
            Dados para pagamento (informativo)
          </Label>
          <Textarea
            id="edit-recipient-payment"
            onChange={(event) => setPaymentNote(event.target.value)}
            rows={2}
            value={paymentNote}
          />
        </div>
        <FieldError message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button disabled={mutation.isPending} type="submit">
            {mutation.isPending ? 'Salvando…' : 'Salvar alterações'}
          </Button>
        </div>
      </form>
    </AppDialog>
  )
}

function RecipientStatusDialog({
  recipient,
  onClose,
}: {
  recipient: Recipient
  onClose: () => void
}) {
  const mutation = useUpdateRecipient()
  const nextActive = !recipient.isActive
  const [error, setError] = useState<string | null>(null)

  return (
    <AppDialog
      description={
        nextActive
          ? 'O recebedor voltará a ficar disponível para novas regras.'
          : 'Recebedores ligados a regras vigentes ou futuras não podem ser desativados. Remova essas regras primeiro para preservar a consistência.'
      }
      footer={
        <Button
          disabled={mutation.isPending}
          onClick={() => {
            setError(null)
            mutation.mutate(
              {
                id: recipient.id,
                payload: { isActive: nextActive },
              },
              {
                onSuccess: () => {
                  toast.success(
                    nextActive
                      ? 'Recebedor reativado.'
                      : 'Recebedor desativado.',
                  )
                  onClose()
                },
                onError: (cause) => setError((cause as Error).message),
              },
            )
          }}
          variant={nextActive ? 'default' : 'destructive'}
        >
          {nextActive ? 'Reativar recebedor' : 'Desativar recebedor'}
        </Button>
      }
      icon={nextActive ? UserRoundCheck : UserMinus}
      maxWidth="md"
      onClose={onClose}
      open
      title={`${nextActive ? 'Reativar' : 'Desativar'} — ${recipient.name}`}
      variant={nextActive ? 'default' : 'destructive'}
    >
      <FieldError message={error} />
    </AppDialog>
  )
}

function VersionDialog({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const mutation = useCreateRuleVersion()
  return (
    <AppDialog
      description="A versão atual terá a vigência encerrada na véspera do novo início. Fechamentos anteriores continuam com a versão usada."
      icon={GitBranch}
      maxWidth="3xl"
      onClose={onClose}
      open
      title={`Editar regra — ${ruleTitle(rule)}`}
    >
      <RuleForm
        initial={{
          ...rule,
          validFrom: '',
          validTo: null,
          housingComplexIds: rule.housingComplexes.map((c) => c.id),
          lockIdentity: true,
        }}
        onSubmit={(payload) =>
          mutation.mutate(
            { lineageId: rule.lineageId, payload },
            {
              onSuccess: () => {
                toast.success('Nova versão criada.')
                onClose()
              },
            },
          )
        }
        pending={mutation.isPending}
        submitLabel="Salvar nova versão"
      />
    </AppDialog>
  )
}

function RevokeDialog({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const mutation = useRevokeRule()
  const [reason, setReason] = useState('')
  return (
    <AppDialog
      description="A revogação vale para cálculos futuros; fechamentos antigos mantêm o snapshot."
      footer={
        <Button
          disabled={reason.trim().length < 3 || mutation.isPending}
          onClick={() =>
            mutation.mutate(
              { id: rule.id, reason },
              {
                onSuccess: () => {
                  toast.success('Regra revogada.')
                  onClose()
                },
              },
            )
          }
          variant="destructive"
        >
          Revogar
        </Button>
      }
      icon={Ban}
      maxWidth="md"
      onClose={onClose}
      open
      title="Revogar regra"
      variant="destructive"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="revoke-reason">Motivo</Label>
        <Textarea
          id="revoke-reason"
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          value={reason}
        />
      </div>
    </AppDialog>
  )
}
