import { eq } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import { db } from '../../shared/db'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import {
  insertRecipient,
  insertRuleVersion,
  loadEngineRules,
  normalizeDocument,
  RULES_LOCK,
  type RuleInput,
} from './finance.config.service'
import {
  type FinanceEngineRule,
  type FinanceRuleNature,
  type FinanceRuleStage,
  findRuleConflicts,
  normalizePoolKey,
  stageNatures,
  validateRuleShape,
} from './finance.engine'
import { parseBRLToCents, parsePercentToBasisPoints } from './finance.money'
import { financeImportBatch, financeRecipient } from './finance.schema'
import {
  assertFinance,
  type FinanceAccess,
  type FinanceDb,
  FinanceServiceError,
  hashPayload,
  isUniqueViolation,
  mapDbError,
  sha256,
  writeAudit,
} from './finance.support'

// Importacao alimenta a MESMA estrutura do cadastro manual (V3 §10, INV-10): cada
// linha vira um RuleInput gravado por insertRuleVersion. A planilha nao e mais
// consultada depois da confirmacao. Nada e gravado antes de confirmar.

export const IMPORT_MAX_BYTES = 1_000_000
export const IMPORT_MAX_ROWS = 1_000

export const importFields = [
  'recipient_name',
  'person_type',
  'document',
  'work_type',
  'base',
  'nature',
  'pool_label',
  'percentage',
  'fixed_value',
  'valid_from',
  'valid_to',
  'condominiums',
  'sort_order',
  'uniqueness',
] as const
export type ImportField = (typeof importFields)[number]
export type ImportMapping = Partial<Record<ImportField, string>>

const requiredFields: ImportField[] = ['base', 'valid_from', 'condominiums']

export const importFieldLabels: Record<ImportField, string> = {
  recipient_name: 'Colaborador',
  person_type: 'Tipo de pessoa',
  document: 'Documento',
  work_type: 'Trabalho',
  base: 'Base',
  nature: 'Natureza',
  pool_label: 'Reserva/provisão',
  percentage: 'Percentual',
  fixed_value: 'Valor fixo',
  valid_from: 'Vigência início',
  valid_to: 'Vigência fim',
  condominiums: 'Condomínios',
  sort_order: 'Ordem',
  uniqueness: 'Unicidade',
}

const aliases: Record<ImportField, string[]> = {
  recipient_name: ['colaborador', 'recebedor', 'recipient name', 'nome'],
  person_type: ['tipo pessoa', 'tipo de pessoa', 'person type'],
  document: ['documento', 'cpf', 'cnpj', 'cpf cnpj'],
  work_type: ['trabalho', 'funcao', 'work type'],
  base: ['base', 'base de calculo', 'base key'],
  nature: ['natureza', 'nature'],
  pool_label: ['reserva', 'provisao', 'reserva provisao', 'pool'],
  percentage: ['percentual', 'percentage', 'porcentagem'],
  fixed_value: ['valor fixo', 'fixed value', 'valor'],
  valid_from: ['vigencia inicio', 'vigencia inicial', 'inicio', 'valid from'],
  valid_to: ['vigencia fim', 'vigencia final', 'fim', 'valid to'],
  condominiums: [
    'condominios',
    'condominio',
    'conjuntos',
    'conjunto',
    'condominiums',
  ],
  sort_order: ['ordem', 'order', 'sort order'],
  uniqueness: ['unicidade', 'uniqueness'],
}

export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function suggestMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {}
  for (const field of importFields) {
    const header = headers.find((h) =>
      aliases[field].includes(normalizeHeader(h)),
    )
    if (header) mapping[field] = header
  }
  return mapping
}

export type ParsedSheet = { headers: string[]; rows: string[][] }

/** CSV/XLSX -> cabecalhos + linhas como TEXTO (formulas nunca executadas). */
export function parseImportFile(
  bytes: Uint8Array,
  fileName: string,
): ParsedSheet {
  if (bytes.byteLength === 0) {
    throw new FinanceServiceError(422, 'Arquivo vazio.')
  }
  if (bytes.byteLength > IMPORT_MAX_BYTES) {
    throw new FinanceServiceError(413, 'Arquivo acima de 1 MB.')
  }
  const lower = fileName.toLowerCase()
  if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) {
    throw new FinanceServiceError(415, 'Envie um arquivo .csv ou .xlsx.')
  }
  if (lower.endsWith('.csv')) {
    return toSheet(parseCsv(new TextDecoder('utf-8').decode(bytes)))
  }
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(bytes, {
      type: 'array',
      cellFormula: false,
      cellHTML: false,
    })
  } catch {
    throw new FinanceServiceError(422, 'Não foi possível ler a planilha.')
  }
  const sheetName = workbook.SheetNames[0]
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
  if (!sheet) throw new FinanceServiceError(422, 'Planilha sem abas.')
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
    dateNF: 'yyyy-mm-dd',
  })
  return toSheet(matrix.map((row) => row.map((cell) => String(cell ?? ''))))
}

/** CSV com deteccao de separador (; , tab) e aspas duplas (RFC 4180). */
export function parseCsv(text: string): string[][] {
  const content = text.replace(/^﻿/, '')
  const firstLine = content.split(/\r?\n/, 1)[0] ?? ''
  const separator = [';', ',', '\t'].sort(
    (a, b) => firstLine.split(b).length - firstLine.split(a).length,
  )[0] as string
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i] as string
    if (quoted) {
      if (char === '"' && content[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === separator) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && content[i + 1] === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function toSheet(matrix: string[][]): ParsedSheet {
  const [headerRow, ...body] = matrix
  const headers = (headerRow ?? []).map((cell) => String(cell ?? '').trim())
  if (headers.filter(Boolean).length === 0) {
    throw new FinanceServiceError(422, 'Planilha sem cabeçalho.')
  }
  if (body.length > IMPORT_MAX_ROWS) {
    throw new FinanceServiceError(413, `Máximo de ${IMPORT_MAX_ROWS} linhas.`)
  }
  const rows = body
    .map((row) => headers.map((_, index) => String(row[index] ?? '').trim()))
    .filter((row) => row.some(Boolean))
  return { headers, rows }
}

function parseCivilDate(value: string): string | null {
  const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : value
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso
    ? null
    : iso
}

function parseStage(value: string): FinanceRuleStage | null {
  const v = normalizeHeader(value)
  if (
    [
      'a',
      'receita total',
      'provisao receita',
      'provisao sobre receita',
    ].includes(v)
  ) {
    return 'PROVISAO_RECEITA'
  }
  if (['c', 'receita liquida', 'deducao liquida'].includes(v))
    return 'DEDUCAO_LIQUIDA'
  if (['i', 'reserva'].includes(v)) return 'RESERVA'
  if (['j', 'resultado 1', 'participacao resultado'].includes(v)) {
    return 'PARTICIPACAO_RESULTADO'
  }
  if (['m', 'resultado 2', 'distribuicao final'].includes(v))
    return 'DISTRIBUICAO_FINAL'
  return null
}

function parseNature(value: string): FinanceRuleNature | null {
  const v = normalizeHeader(value)
  if (['credito', 'participacao', 'distribuicao'].includes(v)) return 'CREDITO'
  if (['provisao', 'despesa'].includes(v)) return 'PROVISAO'
  if (v === 'reserva') return 'RESERVA'
  return null
}

export type ImportRowResult = {
  line: number
  values: Record<string, string>
  errors: string[]
  rule: (RuleInput & { recipientKey: string | null }) | null
  recipient: {
    key: string
    existingId: string | null
    name: string
    kind: 'PESSOA_FISICA' | 'PESSOA_JURIDICA'
    document: string
  } | null
}

type ImportContext = {
  recipients: { id: string; name: string; document: string }[]
  complexes: { id: string; name: string }[]
  activeRules: FinanceEngineRule[]
}

async function loadImportContext(tx: FinanceDb): Promise<ImportContext> {
  // Sequencial: dentro de transacao ha um unico client (sem consultas paralelas).
  const recipients = await tx
    .select({
      id: financeRecipient.id,
      name: financeRecipient.name,
      document: financeRecipient.document,
    })
    .from(financeRecipient)
  const complexes = await tx
    .select({ id: housingComplex.id, name: housingComplex.name })
    .from(housingComplex)
  const activeRules = await loadEngineRules(tx)
  return { recipients, complexes, activeRules }
}

/** Normaliza e valida todas as linhas (sem gravar). */
export function validateImportRows(
  sheet: ParsedSheet,
  mapping: ImportMapping,
  context: ImportContext,
): { rows: ImportRowResult[]; mappingErrors: string[] } {
  const mappingErrors = requiredFields
    .filter(
      (field) =>
        !mapping[field] || !sheet.headers.includes(mapping[field] as string),
    )
    .map(
      (field) => `Campo obrigatório não mapeado: ${importFieldLabels[field]}.`,
    )
  if (!mapping.percentage && !mapping.fixed_value) {
    mappingErrors.push('Mapeie Percentual ou Valor fixo.')
  }
  if (mappingErrors.length > 0) return { rows: [], mappingErrors }

  const column = (field: ImportField) =>
    mapping[field] ? sheet.headers.indexOf(mapping[field] as string) : -1
  const complexByName = new Map(
    context.complexes.map((c) => [normalizeHeader(c.name), c.id]),
  )
  const candidates: FinanceEngineRule[] = []
  const rows: ImportRowResult[] = sheet.rows.map((raw, index) => {
    const get = (field: ImportField) => {
      const i = column(field)
      return i >= 0 ? (raw[i] ?? '').trim() : ''
    }
    const values = Object.fromEntries(
      importFields.filter((f) => mapping[f]).map((f) => [f, get(f)]),
    )
    const errors: string[] = []
    const stage = parseStage(get('base'))
    if (!stage)
      errors.push(`Base inválida: "${get('base')}" (use A, C, I, J ou M).`)
    const natureText = get('nature')
    const name = get('recipient_name')
    let nature: FinanceRuleNature | null = natureText
      ? parseNature(natureText)
      : null
    if (natureText && !nature)
      errors.push(`Natureza inválida: "${natureText}".`)
    if (!natureText && stage) {
      nature =
        stage === 'PROVISAO_RECEITA'
          ? 'PROVISAO'
          : stage === 'RESERVA'
            ? 'RESERVA'
            : name
              ? 'CREDITO'
              : 'PROVISAO'
    }
    if (stage && nature && !stageNatures[stage].includes(nature)) {
      errors.push('Natureza incompatível com a base.')
    }
    const percentText = get('percentage')
    const fixedText = get('fixed_value')
    let basisPoints: number | null = null
    let fixedCents: number | null = null
    if (percentText && fixedText) {
      errors.push('Informe percentual OU valor fixo, não ambos.')
    } else if (percentText) {
      basisPoints = parsePercentToBasisPoints(percentText)
      if (basisPoints === null)
        errors.push(`Percentual inválido: "${percentText}".`)
    } else if (fixedText) {
      fixedCents = parseBRLToCents(fixedText)
      if (fixedCents === null)
        errors.push(`Valor fixo inválido: "${fixedText}".`)
    } else {
      errors.push(
        'Percentual ou valor fixo ausente (use 0 se for intencional).',
      )
    }
    const validFrom = parseCivilDate(get('valid_from'))
    if (!validFrom)
      errors.push(`Vigência início inválida: "${get('valid_from')}".`)
    const validToText = get('valid_to')
    const validTo = validToText ? parseCivilDate(validToText) : null
    if (validToText && !validTo)
      errors.push(`Vigência fim inválida: "${validToText}".`)
    const complexNames = get('condominiums')
      .split(/[;,|]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const housingComplexIds: string[] = []
    for (const complexName of complexNames) {
      const id = complexByName.get(normalizeHeader(complexName))
      if (id) housingComplexIds.push(id)
      else errors.push(`Condomínio não cadastrado: "${complexName}".`)
    }
    if (complexNames.length === 0)
      errors.push('Informe ao menos um condomínio.')
    const orderText = get('sort_order')
    const sortOrder = orderText ? Number(orderText) : 0
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      errors.push(`Ordem inválida: "${orderText}".`)
    }
    const uniquenessText = normalizeHeader(get('uniqueness'))
    const uniqueness = ['unica por processo', 'unica', 'sim'].includes(
      uniquenessText,
    )
      ? ('UNICA_POR_PROCESSO' as const)
      : ('NENHUMA' as const)
    const personType = normalizeHeader(get('person_type'))
    const kind = ['pj', 'pessoa juridica', 'juridica'].includes(personType)
      ? ('PESSOA_JURIDICA' as const)
      : ('PESSOA_FISICA' as const)
    const document = normalizeDocument(get('document'))

    let recipient: ImportRowResult['recipient'] = null
    if (nature === 'CREDITO') {
      if (!name) {
        errors.push('Regra de crédito exige colaborador.')
      } else {
        const byDocument = document
          ? context.recipients.filter((r) => r.document === document)
          : []
        const byName = context.recipients.filter(
          (r) => normalizeHeader(r.name) === normalizeHeader(name),
        )
        const matches = document ? byDocument : byName
        if (!document && byName.length > 1) {
          errors.push(
            `Colaborador ambíguo: "${name}" corresponde a ${byName.length} cadastros; informe o documento.`,
          )
        }
        const existing = matches.length === 1 ? matches[0] : undefined
        recipient = {
          key: existing?.id ?? `novo:${document || normalizeHeader(name)}`,
          existingId: existing?.id ?? null,
          name: existing?.name ?? name,
          kind,
          document,
        }
      }
    }
    const poolLabel =
      nature && nature !== 'CREDITO'
        ? get('pool_label') || get('work_type')
        : null
    if (nature && nature !== 'CREDITO' && !poolLabel) {
      errors.push('Provisão/reserva exige o nome da reserva.')
    }

    let rule: ImportRowResult['rule'] = null
    if (errors.length === 0 && stage && nature && validFrom) {
      rule = {
        stage,
        nature,
        recipientId: recipient?.existingId ?? null,
        recipientKey: recipient?.key ?? null,
        poolLabel,
        workType: get('work_type'),
        valueType: fixedCents !== null ? 'VALOR_FIXO' : 'PERCENTUAL',
        basisPoints,
        fixedCents,
        sortOrder,
        uniqueness,
        validFrom,
        validTo,
        housingComplexIds,
      }
      const candidate: FinanceEngineRule = {
        id: `linha-${index + 2}`,
        lineageId: `linha-${index + 2}`,
        version: 1,
        stage,
        nature,
        recipientId: recipient?.key ?? null,
        recipientName: recipient?.name ?? null,
        poolKey: poolLabel ? normalizePoolKey(poolLabel) : null,
        poolLabel,
        workType: rule.workType ?? '',
        valueType: rule.valueType,
        basisPoints,
        fixedCents,
        sortOrder,
        uniqueness,
        validFrom,
        validTo,
        housingComplexIds: [...housingComplexIds].sort(),
        origin: 'IMPORTACAO',
      }
      const shape = validateRuleShape(candidate)
      errors.push(...shape)
      const conflicts = findRuleConflicts(candidate, [
        ...context.activeRules,
        ...candidates,
      ])
      errors.push(...conflicts.map((c) => `Sobreposição: ${c.message}`))
      if (shape.length === 0 && conflicts.length === 0)
        candidates.push(candidate)
      else rule = null
    }
    return { line: index + 2, values, errors, rule, recipient }
  })
  return { rows, mappingErrors: [] }
}

function summarize(rows: ImportRowResult[]) {
  const valid = rows.filter((row) => row.errors.length === 0)
  const newRecipients = new Map<string, string>()
  for (const row of valid) {
    if (row.recipient && !row.recipient.existingId) {
      newRecipients.set(row.recipient.key, row.recipient.name)
    }
  }
  return {
    total: rows.length,
    valid: valid.length,
    invalid: rows.length - valid.length,
    newRecipients: [...newRecipients.values()],
  }
}

export async function previewImport(
  access: FinanceAccess,
  file: { bytes: Uint8Array; name: string },
  mappingOverride?: ImportMapping,
) {
  assertFinance(access, 'importar', { global: true })
  const sheet = parseImportFile(file.bytes, file.name)
  const mapping = mappingOverride ?? suggestMapping(sheet.headers)
  const context = await loadImportContext(db)
  const { rows, mappingErrors } = validateImportRows(sheet, mapping, context)
  return {
    fileName: file.name,
    fileSha256: sha256(file.bytes),
    headers: sheet.headers,
    mapping,
    fields: importFields.map((field) => ({
      field,
      label: importFieldLabels[field],
      required: requiredFields.includes(field),
    })),
    mappingErrors,
    rows: rows.map(({ line, values, errors }) => ({ line, values, errors })),
    summary: summarize(rows),
  }
}

/** Confirmacao: revalida sob trava e grava tudo ou nada; idempotente por arquivo+mapa. */
export async function confirmImport(
  access: FinanceAccess,
  file: { bytes: Uint8Array; name: string },
  mapping: ImportMapping,
) {
  assertFinance(access, 'importar', { global: true })
  const sheet = parseImportFile(file.bytes, file.name)
  const fileSha256 = sha256(file.bytes)
  const idempotencyKey = `import:${fileSha256}:${hashPayload(mapping)}`
  const [existing] = await db
    .select()
    .from(financeImportBatch)
    .where(eq(financeImportBatch.idempotencyKey, idempotencyKey))
  if (existing) return { batch: existing, replayed: true }
  try {
    const batch = await db.transaction(async (tx) => {
      await tx.execute(RULES_LOCK)
      const context = await loadImportContext(tx)
      const { rows, mappingErrors } = validateImportRows(
        sheet,
        mapping,
        context,
      )
      const invalid = rows.filter((row) => row.errors.length > 0)
      if (mappingErrors.length > 0 || invalid.length > 0 || rows.length === 0) {
        throw new FinanceServiceError(
          422,
          mappingErrors[0] ??
            (rows.length === 0
              ? 'Planilha sem linhas.'
              : `Há ${invalid.length} linha(s) com pendência; corrija antes de confirmar.`),
        )
      }
      const batchId = crypto.randomUUID()
      const summary = summarize(rows)
      const [created] = await tx
        .insert(financeImportBatch)
        .values({
          id: batchId,
          fileName: file.name,
          fileSha256,
          mapping,
          summary,
          rows: rows.map(({ line, values }) => ({ line, values })),
          idempotencyKey,
          createdByUserId: access.actor.id,
        })
        .returning()
      const recipientIds = new Map<string, { id: string; name: string }>()
      for (const row of rows) {
        const rule = row.rule
        if (!rule) continue
        let recipientName: string | null = null
        let recipientId = rule.recipientId ?? null
        if (row.recipient) {
          const known = recipientIds.get(row.recipient.key)
          if (row.recipient.existingId) {
            recipientId = row.recipient.existingId
            recipientName = row.recipient.name
          } else if (known) {
            recipientId = known.id
            recipientName = known.name
          } else {
            const newRecipient = await insertRecipient(
              tx,
              access,
              {
                name: row.recipient.name,
                kind: row.recipient.kind,
                document: row.recipient.document,
              },
              'IMPORTACAO',
              batchId,
            )
            recipientId = newRecipient?.id as string
            recipientName = row.recipient.name
            recipientIds.set(row.recipient.key, {
              id: recipientId,
              name: recipientName,
            })
          }
        }
        const { recipientKey: _ignored, ...input } = rule
        await insertRuleVersion(
          tx,
          access,
          { ...input, recipientId },
          { origin: 'IMPORTACAO', importBatchId: batchId, recipientName },
        )
      }
      await writeAudit(tx, {
        actor: access.actor,
        entityType: 'import_batch',
        entityId: batchId,
        action: 'IMPORTACAO_CONFIRMADA',
        after: { fileName: file.name, fileSha256, summary },
      })
      return created
    })
    return { batch, replayed: false }
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [raced] = await db
        .select()
        .from(financeImportBatch)
        .where(eq(financeImportBatch.idempotencyKey, idempotencyKey))
      if (raced) return { batch: raced, replayed: true }
    }
    mapDbError(error)
  }
}
