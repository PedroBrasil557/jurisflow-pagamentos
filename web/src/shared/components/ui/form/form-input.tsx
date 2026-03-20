import type { ForwardedRef, InputHTMLAttributes } from 'react'
import { forwardRef, useId } from 'react'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'
import { FormField } from './form-field'

type FormInputProps = InputHTMLAttributes<HTMLInputElement> & {
  error?: string
  hint?: string
  inputClassName?: string
  label: string
  required?: boolean
  wrapperClassName?: string
}

export const FormInput = forwardRef(function FormInput(
  {
    error,
    hint,
    inputClassName,
    label,
    required,
    wrapperClassName,
    ...props
  }: FormInputProps,
  ref: ForwardedRef<HTMLInputElement>,
) {
  const fallbackId = useId()
  const fieldId = props.id ?? fallbackId
  const errorId = error ? `${fieldId}-error` : undefined
  const hintId = hint ? `${fieldId}-hint` : undefined
  const describedBy = [props['aria-describedby'], errorId, hintId]
    .filter(Boolean)
    .join(' ')

  return (
    <FormField
      className={wrapperClassName}
      error={error}
      errorId={errorId}
      fieldId={fieldId}
      hint={hint}
      hintId={hintId}
      label={label}
      required={required}
    >
      <Input
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        className={cn(inputClassName)}
        id={fieldId}
        ref={ref}
        required={required}
        {...props}
      />
    </FormField>
  )
})

FormInput.displayName = 'FormInput'
