import { useQuery } from '@tanstack/react-query'
import { KeyRound, Loader2, ScanLine } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Label } from '#/components/ui/label'
import { cn } from '#/lib/utils'
import { Textarea } from '#/components/ui/textarea'
import { PageHeader } from '@/shared/components/page-header'
import { PasswordInput } from '@/shared/components/password-input'
import { SettingsLayout } from '@/shared/components/settings-layout'
import { StatusBadge } from '@/shared/components/status-badge'
import {
  useClearAnthropicKey,
  useClearScanbotKey,
  useSaveAnthropicKey,
  useSaveScanbotKey,
  useSaveScannerProvider,
} from '../services/settings.mutations'
import { settingsStatusOptions } from '../services/settings.queries'
import type { KeyStatus } from '../services/settings.service'

const sourceLabels = {
  database: 'painel',
  environment: 'ambiente',
} as const

type ActiveTab = 'ai' | 'scanner'

type KeyCardProps = {
  title: string
  description: string
  status: KeyStatus | undefined
  isLoading: boolean
  isBusy: boolean
  isSaving: boolean
  placeholder: string
  helpText: string
  multiline?: boolean
  onSave: (value: string) => void
  onClear: () => void
}

function KeyCard({
  title,
  description,
  status,
  isLoading,
  isBusy,
  isSaving,
  placeholder,
  helpText,
  multiline,
  onSave,
  onClear,
}: KeyCardProps) {
  const inputId = useId()
  const [value, setValue] = useState('')

  function handleSave() {
    const trimmed = value.trim()
    if (!trimmed) {
      toast.error('Informe a chave.')
      return
    }
    onSave(trimmed)
    setValue('')
  }

  return (
    <Card>
      <CardContent className="grid gap-5 p-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Status:</span>
          {isLoading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : status?.configured ? (
            <StatusBadge tone="success">
              {`Configurada (•••• ${status.last4 ?? '????'}) — origem: ${
                status.source ? sourceLabels[status.source] : 'desconhecida'
              }`}
            </StatusBadge>
          ) : (
            <StatusBadge tone="warning">Nao configurada</StatusBadge>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor={inputId}>
            {status?.configured ? 'Substituir a chave' : 'Informar a chave'}
          </Label>
          {multiline ? (
            <Textarea
              autoComplete="off"
              className="min-h-28 font-mono text-xs"
              id={inputId}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
              value={value}
            />
          ) : (
            <PasswordInput
              autoComplete="off"
              id={inputId}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
              value={value}
            />
          )}
          <p className="text-xs text-muted-foreground">{helpText}</p>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {status?.source === 'database' ? (
            <Button
              className="text-destructive hover:text-destructive"
              disabled={isBusy}
              onClick={onClear}
              type="button"
              variant="outline"
            >
              Remover chave
            </Button>
          ) : null}
          <Button
            disabled={isBusy || value.trim().length === 0}
            onClick={handleSave}
            type="button"
          >
            {isSaving ? 'Salvando...' : 'Salvar chave'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

type ScannerProvider = 'scanbot' | 'web'

function ScannerProviderSelect({
  provider,
  scanbotConfigured,
  isBusy,
  onChange,
}: {
  provider: ScannerProvider
  scanbotConfigured: boolean
  isBusy: boolean
  onChange: (provider: ScannerProvider) => void
}) {
  const options = [
    {
      value: 'scanbot' as const,
      label: 'Scanbot',
      description: 'Qualidade CamScanner. Requer a license configurada abaixo.',
    },
    {
      value: 'web' as const,
      label: 'Scanner web',
      description: 'Motor base (jscanify), sem license e funciona offline.',
    },
  ]

  return (
    <Card>
      <CardContent className="grid gap-4 p-6">
        <div className="grid gap-1">
          <h3 className="font-heading text-base font-medium text-foreground">
            Servico de digitalizacao
          </h3>
          <p className="text-sm text-muted-foreground">
            Define qual motor o botao "Escanear documento" usa. Se o Scanbot
            falhar, o scanner web e usado com aviso.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <button
              className={cn(
                'rounded-xl border p-4 text-left transition disabled:opacity-60',
                provider === option.value
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-primary/40',
              )}
              disabled={isBusy}
              key={option.value}
              onClick={() => {
                if (provider !== option.value) {
                  onChange(option.value)
                }
              }}
              type="button"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  {option.label}
                </span>
                {provider === option.value ? (
                  <StatusBadge tone="success">Ativo</StatusBadge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {option.description}
              </p>
            </button>
          ))}
        </div>

        {provider === 'scanbot' && !scanbotConfigured ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Scanbot selecionado, mas sem license — o scanner usara o modo web
            ate a license ser configurada abaixo.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  const statusQuery = useQuery(settingsStatusOptions())
  const saveAnthropic = useSaveAnthropicKey()
  const clearAnthropic = useClearAnthropicKey()
  const saveScanbot = useSaveScanbotKey()
  const clearScanbot = useClearScanbotKey()
  const saveScannerProvider = useSaveScannerProvider()

  const [activeTab, setActiveTab] = useState<ActiveTab>('ai')
  const status = statusQuery.data

  function runMutation(
    promise: Promise<{ message: string }>,
    fallback: string,
  ): void {
    void promise.then(
      (result) => toast.success(result.message),
      (error) => toast.error(error instanceof Error ? error.message : fallback),
    )
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Configuracoes"
        description="Ajustes do sistema e integracoes."
      />

      <SettingsLayout
        items={[
          {
            icon: KeyRound,
            isActive: activeTab === 'ai',
            label: 'Integracao com IA',
            onClick: () => setActiveTab('ai'),
          },
          {
            icon: ScanLine,
            isActive: activeTab === 'scanner',
            label: 'Scanner',
            onClick: () => setActiveTab('scanner'),
          },
        ]}
      >
        {activeTab === 'ai' ? (
          <KeyCard
            description="Usada na extracao de dados de documentos (RG/CNH e comprovante) ao cadastrar processos. A chave salva aqui tem prioridade sobre a variavel de ambiente do servidor."
            helpText="Por seguranca, a chave nunca e exibida novamente apos salva — apenas os ultimos digitos."
            isBusy={saveAnthropic.isPending || clearAnthropic.isPending}
            isLoading={statusQuery.isLoading}
            isSaving={saveAnthropic.isPending}
            onClear={() =>
              runMutation(
                clearAnthropic.mutateAsync(),
                'Nao foi possivel remover a chave.',
              )
            }
            onSave={(value) =>
              runMutation(
                saveAnthropic.mutateAsync(value),
                'Nao foi possivel salvar a chave.',
              )
            }
            placeholder="sk-ant-..."
            status={status?.anthropic}
            title="Chave da API Anthropic"
          />
        ) : (
          <div className="grid gap-6">
            <ScannerProviderSelect
              isBusy={saveScannerProvider.isPending}
              onChange={(provider) =>
                runMutation(
                  saveScannerProvider.mutateAsync(provider),
                  'Nao foi possivel salvar o servico de digitalizacao.',
                )
              }
              provider={status?.scanner?.provider ?? 'web'}
              scanbotConfigured={status?.scanbot?.configured ?? false}
            />
            <KeyCard
            description="License key do Scanbot Web SDK, usada no scanner de documentos (qualidade CamScanner, inclusive no iPhone). Sem ela, o scanner usa o modo alternativo (jscanify) com ajuste manual de bordas."
            helpText="Cole a chave inteira (varias linhas). E travada por dominio; sem ela o scanner cai no modo alternativo."
            isBusy={saveScanbot.isPending || clearScanbot.isPending}
            isLoading={statusQuery.isLoading}
            isSaving={saveScanbot.isPending}
            multiline
            onClear={() =>
              runMutation(
                clearScanbot.mutateAsync(),
                'Nao foi possivel remover a license.',
              )
            }
            onSave={(value) =>
              runMutation(
                saveScanbot.mutateAsync(value),
                'Nao foi possivel salvar a license.',
              )
            }
              placeholder="Cole aqui a license key do Scanbot..."
              status={status?.scanbot}
              title="License key do Scanbot"
            />
          </div>
        )}
      </SettingsLayout>
    </div>
  )
}
