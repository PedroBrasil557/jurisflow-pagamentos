import { zValidator } from '@hono/zod-validator'
import type { z } from 'zod'
import type { $ZodIssue } from 'zod/v4/core'

export function getValidationErrorMessage(error: {
  issues?: readonly $ZodIssue[]
}) {
  return error.issues?.[0]?.message ?? 'Dados invalidos.'
}

function validationErrorHandler(
  result: { success: boolean; error?: { issues?: readonly $ZodIssue[] } },
  c: { json: (body: unknown, status: number) => unknown },
) {
  if (!result.success) {
    return c.json(
      {
        message: result.error
          ? getValidationErrorMessage(result.error)
          : 'Dados invalidos.',
      },
      400,
    )
  }
}

export function jsonValidator<TSchema extends z.ZodSchema>(schema: TSchema) {
  return zValidator('json', schema, validationErrorHandler as never)
}

export function queryValidator<TSchema extends z.ZodSchema>(schema: TSchema) {
  return zValidator('query', schema, validationErrorHandler as never)
}

export function paramsValidator<TSchema extends z.ZodSchema>(schema: TSchema) {
  return zValidator('param', schema, validationErrorHandler as never)
}
