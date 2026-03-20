import { differenceInDays } from 'date-fns'
import { Gavel } from 'lucide-react'
import type { ChangeEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { AppDialog } from '@/shared/components/app-dialog'
import {
  useStartProcess,
  useUpdateLegalProcess,
} from '../../services/processes.mutations'

type LegalProcessDialogProps = {
  initialValues?: {
    causeValue: string | null
    legalProcessNumber: string | null
    protocolDate: string | null
  }
  mode: 'start' | 'edit'
  onClose: () => void
  open: boolean
  processId: string
  processInfo: string
}

// Formato: 0000000-00.0.00.0.0000000
function formatLegalProcessNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 20)
  let formatted = ''

  for (let i = 0; i < digits.length; i++) {
    if (i === 7) formatted += '-'
    if (i === 9) formatted += '.'
    if (i === 10) formatted += '.'
    if (i === 12) formatted += '.'
    if (i === 13) formatted += '.'
    formatted += digits[i]
  }

  return formatted
}

const LEGAL_PROCESS_NUMBER_LENGTH = 20

function getElapsedDaysLabel(protocolDate: string) {
  const days = differenceInDays(new Date(), new Date(protocolDate))

  if (days === 0) return 'Hoje'
  if (days === 1) return '1 dia'

  return `${days} dias`
}

export function LegalProcessDialog({
  initialValues,
  mode,
  onClose,
  open,
  processId,
  processInfo,
}: LegalProcessDialogProps) {
  const [legalProcessNumber, setLegalProcessNumber] = useState(
    initialValues?.legalProcessNumber ?? '',
  )
  const [causeValue, setCauseValue] = useState(initialValues?.causeValue ?? '')
  const [protocolDate, setProtocolDate] = useState(
    initialValues?.protocolDate ?? '',
  )

  const startMutation = useStartProcess(processId)
  const updateMutation = useUpdateLegalProcess(processId)

  const isPending = startMutation.isPending || updateMutation.isPending

  async function handleSubmit() {
    const digits = legalProcessNumber.replace(/\D/g, '')

    if (digits.length !== LEGAL_PROCESS_NUMBER_LENGTH) {
      toast.error('O numero do processo deve ter 20 digitos.')
      return
    }

    if (!causeValue.trim()) {
      toast.error('Informe o valor da causa.')
      return
    }

    if (!protocolDate) {
      toast.error('Informe a data do protocolo.')
      return
    }

    const payload = {
      legalProcessNumber: legalProcessNumber.trim(),
      causeValue: causeValue.trim(),
      protocolDate,
    }

    try {
      if (mode === 'start') {
        await startMutation.mutateAsync(payload)
        toast.success('Processo juridico iniciado com sucesso.')
      } else {
        await updateMutation.mutateAsync(payload)
        toast.success('Dados do processo juridico atualizados.')
      }

      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Nao foi possivel salvar.',
      )
    }
  }

  const title =
    mode === 'start' ? 'Iniciar processo juridico' : 'Editar processo juridico'
  const description =
    mode === 'start'
      ? 'Preencha os dados para iniciar o processo juridico.'
      : 'Atualize os dados do processo juridico.'
  const submitLabel =
    mode === 'start' ? 'Iniciar processo' : 'Salvar alteracoes'

  return (
    <AppDialog
      description={description}
      icon={Gavel}
      maxWidth="lg"
      onClose={onClose}
      open={open}
      title={title}
    >
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
        <p className="text-sm text-muted-foreground">{processInfo}</p>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="legal-number">
            Numero do processo
          </label>
          <Input
            id="legal-number"
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setLegalProcessNumber(formatLegalProcessNumber(e.target.value))
            }
            placeholder="0000000-00.0.00.0.0000000"
            value={legalProcessNumber}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="cause-value">
              Valor da causa (R$)
            </label>
            <Input
              id="cause-value"
              onChange={(e) => setCauseValue(e.target.value)}
              placeholder="R$ 0,00"
              value={causeValue}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="protocol-date">
              Data protocolo
            </label>
            <Input
              id="protocol-date"
              onChange={(e) => setProtocolDate(e.target.value)}
              type="date"
              value={protocolDate}
            />
          </div>
        </div>

        {protocolDate ? (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
            <span className="text-sm text-muted-foreground">
              Tempo decorrido
            </span>
            <span className="text-sm font-medium text-primary">
              {getElapsedDaysLabel(protocolDate)}
            </span>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            Preencha os dados para {mode === 'start' ? 'iniciar' : 'atualizar'}{' '}
            o processo.
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          disabled={isPending}
          onClick={onClose}
          type="button"
          variant="outline"
        >
          Cancelar
        </Button>
        <Button disabled={isPending} onClick={handleSubmit} type="button">
          {isPending ? 'Salvando...' : submitLabel}
        </Button>
      </div>
    </AppDialog>
  )
}
