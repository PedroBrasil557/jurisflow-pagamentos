import { type Context, Hono } from 'hono'
import {
  getAuthenticatedUser,
  requireAuth,
} from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import {
  jsonValidator,
  paramsValidator,
  queryValidator,
} from '../../shared/validation/validators'
import {
  downloadAttachment,
  listAttachments,
  uploadAttachment,
} from './finance.attachments.service'
import {
  createAdjustment,
  createClosing,
  createPayout,
  getClosingDetail,
  listClosings,
  listCredits,
  listPayouts,
  previewClosing,
  reverseClosing,
  reversePayout,
} from './finance.closings.service'
import {
  createRecipient,
  createRule,
  createRuleVersion,
  listRecipients,
  listRules,
  revokeRule,
  updateRecipient,
} from './finance.config.service'
import {
  confirmImport,
  type ImportMapping,
  importFields,
  previewImport,
} from './finance.import.service'
import {
  approveReceipt,
  calculateReceipt,
  cancelReceipt,
  createReceipt,
  getReceiptDetail,
  listReceipts,
  updateReceipt,
} from './finance.receipts.service'
import {
  createReserveDebit,
  exportStatementCsv,
  getOverview,
  getStatement,
  listReserveMovements,
  reserveBalances,
  reverseReserveMovement,
} from './finance.reports.service'
import {
  adjustmentPayloadSchema,
  attachmentOwnerParamSchema,
  closingCreateSchema,
  closingPayloadSchema,
  creditQuerySchema,
  idParamSchema,
  payoutPayloadSchema,
  payoutQuerySchema,
  reasonPayloadSchema,
  receiptListQuerySchema,
  receiptPayloadSchema,
  receiptUpdateSchema,
  recipientPayloadSchema,
  recipientUpdateSchema,
  reserveDebitSchema,
  reserveQuerySchema,
  rulePayloadSchema,
  statementQuerySchema,
} from './finance.schemas'
import { FinanceServiceError, resolveFinanceAccess } from './finance.support'

async function access(c: Context<AppBindings>) {
  const user = getAuthenticatedUser(c)
  return resolveFinanceAccess({
    id: user.id,
    role: user.role,
    requestId: c.get('requestId'),
  })
}

async function readFile(c: Context<AppBindings>) {
  const form = await c.req.raw.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    throw new FinanceServiceError(422, 'Envie o arquivo no campo "file".')
  }
  return {
    form,
    file: {
      bytes: new Uint8Array(await file.arrayBuffer()),
      name: file.name,
      type: file.type,
    },
  }
}

function readMapping(form: {
  get: (name: string) => unknown
}): ImportMapping | undefined {
  const raw = form.get('mapping')
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new FinanceServiceError(422, 'Mapeamento inválido.')
  }
  const mapping: ImportMapping = {}
  for (const field of importFields) {
    const value = (parsed as Record<string, unknown>)?.[field]
    if (typeof value === 'string' && value.trim()) mapping[field] = value
  }
  return mapping
}

export const financeRoutes = new Hono<AppBindings>()
  .use('*', requireAuth())
  // ---- visao geral
  .get('/overview', async (c) => {
    try {
      return c.json(await getOverview(await access(c)), 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  // ---- configuracao (P04/P04B)
  .get('/recipients', async (c) => {
    try {
      return c.json({ items: await listRecipients(await access(c)) }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post('/recipients', jsonValidator(recipientPayloadSchema), async (c) => {
    try {
      const recipient = await createRecipient(
        await access(c),
        c.req.valid('json'),
      )
      return c.json({ recipient }, 201)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .patch(
    '/recipients/:id',
    paramsValidator(idParamSchema),
    jsonValidator(recipientUpdateSchema),
    async (c) => {
      try {
        const recipient = await updateRecipient(
          await access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        )
        return c.json({ recipient }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get('/rules', async (c) => {
    try {
      return c.json({ items: await listRules(await access(c)) }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post('/rules', jsonValidator(rulePayloadSchema), async (c) => {
    try {
      const rule = await createRule(await access(c), c.req.valid('json'))
      return c.json({ rule }, 201)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post(
    '/rules/:id/versions',
    paramsValidator(idParamSchema),
    jsonValidator(rulePayloadSchema),
    async (c) => {
      try {
        const rule = await createRuleVersion(
          await access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        )
        return c.json({ rule }, 201)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/rules/:id/revoke',
    paramsValidator(idParamSchema),
    jsonValidator(reasonPayloadSchema),
    async (c) => {
      try {
        const rule = await revokeRule(
          await access(c),
          c.req.valid('param').id,
          c.req.valid('json').reason,
        )
        return c.json({ rule }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  // ---- importacao (P04C)
  .post('/imports/preview', async (c) => {
    try {
      const { form, file } = await readFile(c)
      const preview = await previewImport(
        await access(c),
        file,
        readMapping(form),
      )
      return c.json(preview, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post('/imports/confirm', async (c) => {
    try {
      const { form, file } = await readFile(c)
      const mapping = readMapping(form)
      if (!mapping) {
        throw new FinanceServiceError(422, 'Confirme o mapeamento das colunas.')
      }
      const result = await confirmImport(await access(c), file, mapping)
      return c.json(result, result.replayed ? 200 : 201)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  // ---- recebimentos (P01/P02/P03/P09)
  .get('/receipts', queryValidator(receiptListQuerySchema), async (c) => {
    try {
      const items = await listReceipts(await access(c), c.req.valid('query'))
      return c.json({ items }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post('/receipts', jsonValidator(receiptPayloadSchema), async (c) => {
    try {
      const result = await createReceipt(await access(c), c.req.valid('json'))
      return c.json(result, result.replayed ? 200 : 201)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get('/receipts/:id', paramsValidator(idParamSchema), async (c) => {
    try {
      const detail = await getReceiptDetail(
        await access(c),
        c.req.valid('param').id,
      )
      return c.json(detail, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .patch(
    '/receipts/:id',
    paramsValidator(idParamSchema),
    jsonValidator(receiptUpdateSchema),
    async (c) => {
      try {
        const receipt = await updateReceipt(
          await access(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        )
        return c.json({ receipt }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/receipts/:id/calculate',
    paramsValidator(idParamSchema),
    async (c) => {
      try {
        const receipt = await calculateReceipt(
          await access(c),
          c.req.valid('param').id,
        )
        return c.json({ receipt }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post('/receipts/:id/approve', paramsValidator(idParamSchema), async (c) => {
    try {
      const receipt = await approveReceipt(
        await access(c),
        c.req.valid('param').id,
      )
      return c.json({ receipt }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post(
    '/receipts/:id/cancel',
    paramsValidator(idParamSchema),
    jsonValidator(reasonPayloadSchema),
    async (c) => {
      try {
        const receipt = await cancelReceipt(
          await access(c),
          c.req.valid('param').id,
          c.req.valid('json').reason,
        )
        return c.json({ receipt }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  // ---- fechamentos (P06), creditos, baixas (P07), ajustes
  .get('/closings', async (c) => {
    try {
      return c.json({ items: await listClosings(await access(c)) }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post('/closings/preview', jsonValidator(closingPayloadSchema), async (c) => {
    try {
      return c.json(
        await previewClosing(await access(c), c.req.valid('json')),
        200,
      )
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post('/closings', jsonValidator(closingCreateSchema), async (c) => {
    try {
      const result = await createClosing(await access(c), c.req.valid('json'))
      return c.json(result, result.replayed ? 200 : 201)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get('/closings/:id', paramsValidator(idParamSchema), async (c) => {
    try {
      return c.json(
        await getClosingDetail(await access(c), c.req.valid('param').id),
        200,
      )
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post(
    '/closings/:id/reverse',
    paramsValidator(idParamSchema),
    jsonValidator(reasonPayloadSchema),
    async (c) => {
      try {
        const closing = await reverseClosing(
          await access(c),
          c.req.valid('param').id,
          c.req.valid('json').reason,
        )
        return c.json({ closing }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get('/credits', queryValidator(creditQuerySchema), async (c) => {
    try {
      const items = await listCredits(await access(c), c.req.valid('query'))
      return c.json({ items }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get('/payouts', queryValidator(payoutQuerySchema), async (c) => {
    try {
      const items = await listPayouts(await access(c), c.req.valid('query'))
      return c.json({ items }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post('/payouts', jsonValidator(payoutPayloadSchema), async (c) => {
    try {
      const result = await createPayout(await access(c), c.req.valid('json'))
      return c.json(result, result.replayed ? 200 : 201)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post(
    '/payouts/:id/reverse',
    paramsValidator(idParamSchema),
    jsonValidator(reasonPayloadSchema),
    async (c) => {
      try {
        const payout = await reversePayout(
          await access(c),
          c.req.valid('param').id,
          c.req.valid('json').reason,
        )
        return c.json({ payout }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post('/adjustments', jsonValidator(adjustmentPayloadSchema), async (c) => {
    try {
      const result = await createAdjustment(
        await access(c),
        c.req.valid('json'),
      )
      return c.json(result, result.replayed ? 200 : 201)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  // ---- extrato (P08)
  .get('/statement', queryValidator(statementQuerySchema), async (c) => {
    try {
      return c.json(
        await getStatement(await access(c), c.req.valid('query')),
        200,
      )
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get('/statement.csv', queryValidator(statementQuerySchema), async (c) => {
    try {
      const csv = await exportStatementCsv(
        await access(c),
        c.req.valid('query'),
      )
      return c.body(csv, 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="extrato-pagamentos.csv"',
        'Cache-Control': 'no-store',
      })
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  // ---- reservas (P10)
  .get('/reserves', async (c) => {
    try {
      return c.json({ items: await reserveBalances(await access(c)) }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get('/reserves/movements', queryValidator(reserveQuerySchema), async (c) => {
    try {
      const items = await listReserveMovements(
        await access(c),
        c.req.valid('query'),
      )
      return c.json({ items }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post('/reserves/movements', jsonValidator(reserveDebitSchema), async (c) => {
    try {
      const result = await createReserveDebit(
        await access(c),
        c.req.valid('json'),
      )
      return c.json(result, result.replayed ? 200 : 201)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post(
    '/reserves/movements/:id/reverse',
    paramsValidator(idParamSchema),
    jsonValidator(reasonPayloadSchema),
    async (c) => {
      try {
        const movement = await reverseReserveMovement(
          await access(c),
          c.req.valid('param').id,
          c.req.valid('json').reason,
        )
        return c.json({ movement }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  // ---- comprovantes privados
  .get(
    '/attachments/:ownerKind/:ownerId',
    paramsValidator(attachmentOwnerParamSchema),
    async (c) => {
      try {
        const { ownerKind, ownerId } = c.req.valid('param')
        const items = await listAttachments(await access(c), {
          kind: ownerKind,
          id: ownerId,
        })
        return c.json({ items }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/attachments/:ownerKind/:ownerId',
    paramsValidator(attachmentOwnerParamSchema),
    async (c) => {
      try {
        const { ownerKind, ownerId } = c.req.valid('param')
        const { file } = await readFile(c)
        const attachment = await uploadAttachment(
          await access(c),
          { kind: ownerKind, id: ownerId },
          file,
        )
        return c.json({ attachment }, 201)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get('/attachment-files/:id', paramsValidator(idParamSchema), async (c) => {
    try {
      const file = await downloadAttachment(
        await access(c),
        c.req.valid('param').id,
      )
      return c.body(file.bytes as Uint8Array<ArrayBuffer>, 200, {
        'Content-Type': file.mimeType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
