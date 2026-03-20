import { zodResolver } from '@hookform/resolvers/zod'
import type { FieldValues, Resolver, UseFormProps } from 'react-hook-form'
import { useForm } from 'react-hook-form'
import type * as z4 from 'zod/v4/core'

type UseZodFormOptions<
  TFieldValues extends FieldValues,
  TTransformedValues extends FieldValues = TFieldValues,
> = Omit<
  UseFormProps<TFieldValues, undefined, TTransformedValues>,
  'resolver'
> & {
  schema: z4.$ZodType<TTransformedValues, TFieldValues>
}

export function useZodForm<
  TFieldValues extends FieldValues,
  TTransformedValues extends FieldValues = TFieldValues,
>({ schema, ...options }: UseZodFormOptions<TFieldValues, TTransformedValues>) {
  return useForm<TFieldValues, undefined, TTransformedValues>({
    ...options,
    resolver: zodResolver(schema) as Resolver<
      TFieldValues,
      undefined,
      TTransformedValues
    >,
  })
}
