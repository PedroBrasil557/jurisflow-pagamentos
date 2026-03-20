import type {
  ForwardedRef,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { forwardRef } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { cn } from '#/lib/utils'
import type { BinaryChoice, SelectOption } from '../../process-form.types'

type ProcessFormFieldProps = {
  children: ReactNode
  error?: string
  hint?: string
  label: string
  required?: boolean
}

type ProcessTextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  error?: string
  hint?: string
  label: string
  required?: boolean
}

type ProcessSelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  error?: string
  hint?: string
  label: string
  options: readonly SelectOption[]
  required?: boolean
}

type ProcessTextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  error?: string
  hint?: string
  label: string
  required?: boolean
}

type ProcessRadioGroupFieldProps = {
  error?: string
  label: string
  onChange: (value: BinaryChoice) => void
  options: readonly { label: string; value: Exclude<BinaryChoice, ''> }[]
  value: BinaryChoice
}

export function ProcessFormField({
  children,
  error,
  hint,
  label,
  required,
}: ProcessFormFieldProps) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">
        {label}
        {required ? ' *' : ''}
      </span>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export const ProcessTextField = forwardRef(function ProcessTextField(
  { error, hint, label, required, className, ...props }: ProcessTextFieldProps,
  ref: ForwardedRef<HTMLInputElement>,
) {
  return (
    <ProcessFormField
      error={error}
      hint={hint}
      label={label}
      required={required}
    >
      <Input
        aria-invalid={error ? true : undefined}
        aria-label={label}
        className={cn(className)}
        ref={ref}
        required={required}
        {...props}
      />
    </ProcessFormField>
  )
})

export const ProcessSelectField = forwardRef(function ProcessSelectField(
  {
    error,
    hint,
    label,
    options,
    required,
    className,
    ...props
  }: ProcessSelectFieldProps,
  ref: ForwardedRef<HTMLSelectElement>,
) {
  return (
    <ProcessFormField
      error={error}
      hint={hint}
      label={label}
      required={required}
    >
      <select
        aria-invalid={error ? true : undefined}
        aria-label={label}
        className={cn(
          'h-9 w-full appearance-none rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed dark:bg-input/30',
          error && 'border-destructive',
          className,
        )}
        ref={ref}
        required={required}
        {...props}
      >
        {options.map((option) => (
          <option
            className="bg-background text-foreground"
            key={option.value || 'blank'}
            value={option.value}
          >
            {option.label}
          </option>
        ))}
      </select>
    </ProcessFormField>
  )
})

export const ProcessTextAreaField = forwardRef(function ProcessTextAreaField(
  {
    error,
    hint,
    label,
    required,
    className,
    ...props
  }: ProcessTextAreaFieldProps,
  ref: ForwardedRef<HTMLTextAreaElement>,
) {
  return (
    <ProcessFormField
      error={error}
      hint={hint}
      label={label}
      required={required}
    >
      <Textarea
        aria-invalid={error ? true : undefined}
        aria-label={label}
        className={cn('min-h-32', className)}
        ref={ref}
        required={required}
        {...props}
      />
    </ProcessFormField>
  )
})

export function ProcessRadioGroupField({
  error,
  label,
  onChange,
  options,
  value,
}: ProcessRadioGroupFieldProps) {
  return (
    <ProcessFormField error={error} label={label}>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = value === option.value

          return (
            <Button
              key={option.value}
              onClick={() => onChange(option.value)}
              size="sm"
              type="button"
              variant={isActive ? 'default' : 'outline'}
            >
              {option.label}
            </Button>
          )
        })}
      </div>
    </ProcessFormField>
  )
}

ProcessTextField.displayName = 'ProcessTextField'
ProcessSelectField.displayName = 'ProcessSelectField'
ProcessTextAreaField.displayName = 'ProcessTextAreaField'
