import { z } from 'zod'

export const processChecklistItemFormSchema = z
  .object({
    file: z
      .custom<File | null>(
        (value) => value === null || value instanceof File,
        'Selecione um arquivo valido.',
      )
      .nullable(),
    markOkWithoutFile: z.boolean(),
    observation: z
      .string()
      .trim()
      .max(300, { message: 'A observacao pode ter no maximo 300 caracteres.' }),
  })
  .superRefine((data, ctx) => {
    if (data.file && data.markOkWithoutFile) {
      ctx.addIssue({
        code: 'custom',
        message: 'Escolha entre anexar um arquivo ou marcar OK sem arquivo.',
        path: ['markOkWithoutFile'],
      })
    }
  })

export type ProcessChecklistItemFormValues = z.infer<
  typeof processChecklistItemFormSchema
>
