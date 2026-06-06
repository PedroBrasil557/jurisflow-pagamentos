import { useQuery } from '@tanstack/react-query'
import { KeyRound, Loader2 } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Label } from '#/components/ui/label'
import { PageHeader } from '@/shared/components/page-header'
import { PasswordInput } from '@/shared/components/password-input'
import { SettingsLayout } from '@/shared/components/settings-layout'
import { StatusBadge } from '@/shared/components/status-badge'
import {
  useClearAnthropicKey,
  useSaveAnthropicKey,
} from '../services/settings.mutations'
import { anthropicKeyStatusOptions } from '../services/settings.queries'

const sourceLabels = {
  database: 'painel',
  environment: 'ambiente',
} as const

export function SettingsPage() {
  const statusQuery = useQuery(anthropicKeyStatusOptions())
  const saveMutation = useSaveAnthropicKey()
  const clearMutation = useClearAnthropicKey()

  const inputId = useId()
  const [apiKey, setApiKey] = useState('')

  const status = statusQuery.data
  const isBusy = saveMutation.isPending || clearMutation.isPending

  async function handleSave() {
    const trimmed = apiKey.trim()

    if (!trimmed) {
      toast.error('Informe a chave da API.')
      return
    }

    try {
      const result = await saveMutation.mutateAsync(trimmed)
      toast.success(result.message)
      setApiKey('')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel salvar a chave.',
      )
    }
  }

  async function handleClear() {
    try {
      const result = await clearMutation.mutateAsync()
      toast.success(result.message)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel remover a chave.',
      )
    }
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
            isActive: true,
            label: 'Integracao com IA',
            onClick: () => undefined,
          },
        ]}
      >
        <Card>
          <CardContent className="grid gap-5 p-6">
            <div className="grid gap-1">
              <h2 className="text-lg font-semibold text-foreground">
                Chave da API Anthropic
              </h2>
              <p className="text-sm text-muted-foreground">
                Usada na extracao de dados de documentos (RG/CNH e comprovante)
                ao cadastrar processos. A chave salva aqui tem prioridade sobre
                a variavel de ambiente do servidor.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                Status:
              </span>
              {statusQuery.isLoading ? (
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
              <PasswordInput
                autoComplete="off"
                id={inputId}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-ant-..."
                value={apiKey}
              />
              <p className="text-xs text-muted-foreground">
                Por seguranca, a chave nunca e exibida novamente apos salva —
                apenas os ultimos digitos.
              </p>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {status?.source === 'database' ? (
                <Button
                  disabled={isBusy}
                  onClick={() => void handleClear()}
                  type="button"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                >
                  Remover chave
                </Button>
              ) : null}
              <Button
                disabled={isBusy || apiKey.trim().length === 0}
                onClick={() => void handleSave()}
                type="button"
              >
                {saveMutation.isPending ? 'Salvando...' : 'Salvar chave'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </SettingsLayout>
    </div>
  )
}
