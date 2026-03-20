import type { ForwardedRef, SelectHTMLAttributes } from 'react'
import { forwardRef, useId } from 'react'
import { NativeSelect } from '#/components/ui/native-select'
import { cn } from '#/lib/utils'
import { FormField } from './form-field'

type SelectOption = {
  label: string
  value: string
}

type FormSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  error?: string
  hint?: string
  label: string
  options: readonly SelectOption[]
  required?: boolean
  selectClassName?: string
  wrapperClassName?: string
}

export const FormSelect = forwardRef(function FormSelect(
  {
    error,
    hint,
    label,
    options,
    required,
    selectClassName,
    wrapperClassName,
    ...props
  }: FormSelectProps,
  ref: ForwardedRef<HTMLSelectElement>,
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
      <NativeSelect
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        className={cn('w-full', selectClassName)}
        id={fieldId}
        ref={ref}
        required={required}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value || 'blank'} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </FormField>
  )
})

FormSelect.displayName = 'FormSelect'
