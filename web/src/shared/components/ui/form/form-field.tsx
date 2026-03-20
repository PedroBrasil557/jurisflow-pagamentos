import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

type FormFieldProps = {
  children: ReactNode
  className?: string
  error?: string
  errorId?: string
  fieldId?: string
  hint?: string
  hintId?: string
  label: string
  labelClassName?: string
  required?: boolean
}

export function FormField({
  children,
  className,
  error,
  errorId,
  fieldId,
  hint,
  hintId,
  label,
  labelClassName,
  required,
}: FormFieldProps) {
  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      <label
        className={cn('text-sm font-medium', labelClassName)}
        htmlFor={fieldId}
      >
        {label}
        {required ? ' *' : ''}
      </label>
      {children}
      {error ? (
        <span className="text-sm text-destructive" id={errorId}>
          {error}
        </span>
      ) : null}
      {hint ? (
        <span className="text-sm text-muted-foreground" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}
