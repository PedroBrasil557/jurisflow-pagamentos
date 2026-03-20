import type { ForwardedRef, TextareaHTMLAttributes } from 'react'
import { forwardRef, useId } from 'react'
import { Textarea } from '#/components/ui/textarea'
import { cn } from '#/lib/utils'
import { FormField } from './form-field'

type FormTextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  error?: string
  hint?: string
  label: string
  required?: boolean
  textareaClassName?: string
  wrapperClassName?: string
}

export const FormTextArea = forwardRef(function FormTextArea(
  {
    error,
    hint,
    label,
    required,
    textareaClassName,
    wrapperClassName,
    ...props
  }: FormTextAreaProps,
  ref: ForwardedRef<HTMLTextAreaElement>,
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
      <Textarea
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        className={cn(textareaClassName)}
        id={fieldId}
        ref={ref}
        required={required}
        {...props}
      />
    </FormField>
  )
})

FormTextArea.displayName = 'FormTextArea'
