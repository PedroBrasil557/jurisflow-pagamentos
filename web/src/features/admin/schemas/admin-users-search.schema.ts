import { z } from 'zod'

const adminUsersSearchSchema = z.object({
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

export type AdminUsersSearch = {
  page?: number
  search?: string
}

export function parseAdminUsersSearch(
  search: Record<string, unknown>,
): AdminUsersSearch {
  const result = adminUsersSearchSchema.safeParse(search)

  if (!result.success) {
    return {}
  }

  return {
    ...(result.data.page ? { page: result.data.page } : {}),
    ...(result.data.search ? { search: result.data.search } : {}),
  }
}
