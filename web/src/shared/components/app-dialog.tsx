import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { cn } from '#/lib/utils'

type AppDialogVariant =
  | 'default'
  | 'destructive'
  | 'info'
  | 'success'
  | 'warning'

type AppDialogProps = {
  children: ReactNode
  description?: string
  footer?: ReactNode
  icon?: LucideIcon
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'
  onClose: () => void
  open: boolean
  title: string
  variant?: AppDialogVariant
}

const maxWidthClasses = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '3xl': 'sm:max-w-3xl',
}

const iconVariantClasses: Record<AppDialogVariant, string> = {
  default: 'bg-primary/10 text-primary',
  info: 'bg-blue-500/10 text-blue-500',
  success: 'bg-emerald-500/10 text-emerald-500',
  warning: 'bg-amber-500/10 text-amber-500',
  destructive: 'bg-red-500/10 text-red-500',
}

export function AppDialog({
  children,
  description,
  footer,
  icon: Icon,
  maxWidth = '2xl',
  onClose,
  open,
  title,
  variant = 'default',
}: AppDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogContent
        className={cn('flex max-h-[90vh] flex-col', maxWidthClasses[maxWidth])}
      >
        <DialogHeader className="shrink-0">
          <div className="flex items-start gap-4">
            {Icon ? (
              <div
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-lg',
                  iconVariantClasses[variant],
                )}
              >
                <Icon className="size-5" />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg">{title}</DialogTitle>
              {description ? (
                <DialogDescription className="mt-1">
                  {description}
                </DialogDescription>
              ) : null}
            </div>
          </div>
        </DialogHeader>
        <div className="-mx-1 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-1">
          {children}
        </div>
        {footer ? (
          <DialogFooter className="shrink-0">{footer}</DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export { DialogFooter }
