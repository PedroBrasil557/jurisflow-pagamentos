import { z } from 'zod'

const processesSearchSchema = z.object({
  page: z
    .preprocess((value) => {
      if (typeof value === 'number') {
        return value
      }

      if (typeof value === 'string' && value.trim()) {
        return Number(value)
      }

      return undefined
    }, z.number().int().min(1).optional())
    .optional(),
  search: z
    .preprocess(
      (value) => (typeof value === 'string' ? value.trim() : undefined),
      z.string().optional(),
    )
    .optional(),
})

export type ProcessesSearch = {
  page?: number
  search?: string
}

export function parseProcessesSearch(
  search: Record<string, unknown>,
): ProcessesSearch {
  const result = processesSearchSchema.safeParse(search)

  if (!result.success) {
    return {}
  }

  return {
    ...(result.data.page ? { page: result.data.page } : {}),
    ...(result.data.search ? { search: result.data.search } : {}),
  }
}
