import type { LucideIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { AppDialog } from './app-dialog'

type ConfirmDialogVariant = 'default' | 'destructive'

type ConfirmDialogProps = {
  cancelLabel?: string
  confirmDisabled?: boolean
  confirmLabel: string
  description: string
  detail?: string
  detailLabel?: string
  icon: LucideIcon
  isLoading: boolean
  loadingLabel?: string
  onClose: () => void
  onConfirm: () => void
  open: boolean
  title: string
  variant?: ConfirmDialogVariant
}

export function ConfirmDialog({
  cancelLabel = 'Cancelar',
  confirmDisabled = false,
  confirmLabel,
  description,
  detail,
  detailLabel,
  icon,
  isLoading,
  loadingLabel,
  onClose,
  onConfirm,
  open,
  title,
  variant = 'default',
}: ConfirmDialogProps) {
  return (
    <AppDialog
      description={description}
      icon={icon}
      maxWidth="lg"
      onClose={onClose}
      open={open}
      title={title}
      variant={variant === 'destructive' ? 'destructive' : 'default'}
    >
      {detail ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          {detailLabel ? (
            <p className="text-sm text-muted-foreground">{detailLabel}</p>
          ) : null}
          <p
            className={`text-sm font-medium text-foreground ${detailLabel ? 'mt-1' : ''}`}
          >
            {detail}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          disabled={isLoading}
          onClick={onClose}
          type="button"
          variant="outline"
        >
          {cancelLabel}
        </Button>
        <Button
          disabled={isLoading || confirmDisabled}
          onClick={onConfirm}
          type="button"
          variant={variant === 'destructive' ? 'destructive' : 'default'}
        >
          {isLoading ? (loadingLabel ?? confirmLabel) : confirmLabel}
        </Button>
      </div>
    </AppDialog>
  )
}
