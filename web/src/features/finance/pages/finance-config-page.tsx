import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Ban, FileSpreadsheet, GitBranch, Plus, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
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
} from '../lib/finance-money'
import {
  financeAccess,
  natureLabels,
  stageLabels,
  stageOrder,
} from '../lib/finance-labels'
import {
  useCreateRecipient,
  useCreateRuleVersion,
  useRevokeRule,
} from '../services/finance.mutations'
import { recipientsQuery, rulesQuery } from '../services/finance.queries'
import type { Rule } from '../services/finance.service'

function ruleValue(rule: Rule) {
  return rule.valueType === 'VALOR_FIXO'
    ? rule.fixedCents === null
      ? 'não configurado'
      : formatCents(rule.fixedCents)
    : formatBasisPoints(rule.basisPoints)
}

/** P04: configuração inicial — recebedores e regras versionadas. */
export function FinanceConfigPage() {
  const { permissions } = useSession()
  const canEdit = financeAccess.regras(permissions)
  const recipients = useQuery(recipientsQuery())
  const rules = useQuery(rulesQuery())
  const [recipientOpen, setRecipientOpen] = useState(false)
  const [versionOf, setVersionOf] = useState<Rule | null>(null)
  const [revoking, setRevoking] = useState<Rule | null>(null)

  const isEmpty = recipients.data?.length === 0 && rules.data?.length === 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="O motor conhece as etapas e a matemática; recebedores, percentuais, vigências e condomínios vêm daqui. Alterar cria nova versão e não muda fechamentos anteriores."
        eyebrow="Pagamentos"
        title="Configuração"
      >
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setRecipientOpen(true)} variant="outline">
              <UserPlus className="size-4" />
              Adicionar colaborador
            </Button>
            {financeAccess.importar(permissions) ? (
              <Button asChild variant="outline">
                <Link
                  className="no-underline"
                  preload={false}
                  to="/pagamentos/configuracao/importar"
                >
                  <FileSpreadsheet className="size-4" />
                  Importar
                </Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link
                className="no-underline"
                preload={false}
                to="/pagamentos/configuracao/novo"
              >
                <Plus className="size-4" />
                Nova regra
              </Link>
            </Button>
          </div>
        ) : null}
      </PageHeader>

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
          description="Primeiro acesso: nenhum colaborador, função, percentual, vigência ou vínculo com condomínio. Cadastre manualmente ou importe uma planilha — as duas entradas alimentam a mesma estrutura."
          title="Nenhuma configuração cadastrada"
        />
      ) : null}

      {rules.data && rules.data.length > 0 ? (
        <div className="grid gap-4">
          {stageOrder.map((stage) => {
            const list = rules.data.filter((rule) => rule.stage === stage)
            return (
              <FinanceSection
                description={`Base: ${stageLabels[stage]?.base}`}
                key={stage}
                title={stageLabels[stage]?.label ?? stage}
              >
                {list.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma regra nesta etapa.
                    {stage === 'PROVISAO_RECEITA' ||
                    stage === 'DISTRIBUICAO_FINAL'
                      ? ' Etapa obrigatória: sem ela o cálculo fica bloqueado (0% é aceito).'
                      : ''}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Recebedor/reserva</TableHead>
                          <TableHead>Valor</TableHead>
                          <TableHead>Vigência</TableHead>
                          <TableHead>Condomínios</TableHead>
                          <TableHead>Versão</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {list.map((rule) => (
                          <TableRow
                            className={
                              rule.status === 'REVOGADA' ? 'opacity-60' : ''
                            }
                            key={rule.id}
                          >
                            <TableCell>
                              <div className="font-medium">
                                {rule.recipientName ?? rule.poolLabel}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {natureLabels[rule.nature]}
                                {rule.workType ? ` · ${rule.workType}` : ''}
                                {rule.uniqueness === 'UNICA_POR_PROCESSO'
                                  ? ' · única por processo'
                                  : ''}
                              </div>
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {rule.basisPoints === null &&
                              rule.fixedCents === null ? (
                                <StatusBadge tone="warning">
                                  não configurado
                                </StatusBadge>
                              ) : (
                                ruleValue(rule)
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              {formatCivilDate(rule.validFrom)} –{' '}
                              {rule.validTo
                                ? formatCivilDate(rule.validTo)
                                : 'aberta'}
                            </TableCell>
                            <TableCell className="max-w-56 text-sm">
                              {rule.housingComplexes
                                .map((c) => c.name)
                                .join(', ')}
                            </TableCell>
                            <TableCell className="text-sm">
                              v{rule.version}
                              <div className="text-xs text-muted-foreground">
                                {rule.origin === 'IMPORTACAO'
                                  ? 'importada'
                                  : 'manual'}
                                {rule.status === 'REVOGADA'
                                  ? ' · revogada'
                                  : ''}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              {canEdit && rule.status === 'ATIVA' ? (
                                <div className="flex justify-end gap-1">
                                  <Button
                                    onClick={() => setVersionOf(rule)}
                                    size="sm"
                                    variant="ghost"
                                  >
                                    <GitBranch className="size-4" />
                                    Nova versão
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
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </FinanceSection>
            )
          })}
        </div>
      ) : null}

      {recipients.data && recipients.data.length > 0 ? (
        <FinanceSection
          description="Identidade estável, separada das contas de login."
          title="Recebedores"
        >
          <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {recipients.data.map((recipient) => (
              <li
                className="rounded-md border border-border px-3 py-2"
                key={recipient.id}
              >
                <div className="font-medium">{recipient.name}</div>
                <div className="text-xs text-muted-foreground">
                  {recipient.kind === 'PESSOA_JURIDICA'
                    ? 'Pessoa jurídica'
                    : 'Pessoa física'}
                  {recipient.document ? ` · ${recipient.document}` : ''}
                  {recipient.origin === 'IMPORTACAO' ? ' · importado' : ''}
                  {recipient.isActive ? '' : ' · inativo'}
                </div>
              </li>
            ))}
          </ul>
        </FinanceSection>
      ) : null}

      <RecipientDialog
        onClose={() => setRecipientOpen(false)}
        open={recipientOpen}
      />
      {versionOf ? (
        <VersionDialog onClose={() => setVersionOf(null)} rule={versionOf} />
      ) : null}
      {revoking ? (
        <RevokeDialog onClose={() => setRevoking(null)} rule={revoking} />
      ) : null}
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
      },
    )
  }
  return (
    <AppDialog
      icon={UserPlus}
      maxWidth="md"
      onClose={onClose}
      open={open}
      title="Adicionar colaborador/recebedor"
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
          Nomes parecidos não são unidos: cada cadastro é uma identidade
          própria.
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

function VersionDialog({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const mutation = useCreateRuleVersion()
  return (
    <AppDialog
      description="A versão atual terá a vigência encerrada na véspera do novo início. Fechamentos anteriores continuam com a versão usada."
      icon={GitBranch}
      maxWidth="3xl"
      onClose={onClose}
      open
      title={`Nova versão — ${rule.recipientName ?? rule.poolLabel}`}
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
        submitLabel="Criar versão"
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
