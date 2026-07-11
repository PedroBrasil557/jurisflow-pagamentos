import { sql } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import { logEvent } from '../../shared/observability/log'
import { isValidCpf, normalizeCpf } from '../../shared/utils/cpf'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import { enqueueManyQuitacao } from '../quitacao-queue/quitacao-queue.service'
import { titularContratoCaixa } from './titulares-caixa.schema'

// Cabecalho esperado da planilha "lista_titular_contrato_caixa" (12 colunas).
const HEADER_MAP = {
  UF: 'uf',
  Nome_Municipio: 'municipio',
  Nome_Modalidade: 'modalidade',
  Nome_Empreendimento: 'empreendimento',
  Nome_do_Mutuario: 'mutuarioNome',
  Numero_CPF_Mutuario: 'cpf',
  Numero_PIS_do_Mutuario: 'pis',
  Data_da_Assinatura: 'dataAssinatura',
  Nome_Logradouro_do_Imovel: 'logradouro',
  Numero_Imovel: 'numeroImovel',
  Complemento_do_Imovel: 'complemento',
  Bairro_do_Imovel: 'bairro',
} as const

const REQUIRED_HEADERS = Object.keys(HEADER_MAP)

// Remove NUL bytes (o Postgres rejeita byte NUL em colunas text) e normaliza espacos.
function cleanText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value).replaceAll('\u0000', '').trim()
}

// CPF/PIS guardado como NUMERO na planilha perde zeros a esquerda (ex.: o CPF
// 025.174.455-83 vira 2517445583, 10 digitos). Left-pad para 11 antes de validar
// recupera esses casos. Valores ja com 11 digitos nao mudam; valores curtos demais
// continuam reprovando no check digit (isValidCpf). Sem digitos -> ''.
function padDigits11(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (!digits) return ''
  return digits.length < 11 ? digits.padStart(11, '0') : digits
}

// Converte a data de assinatura (serial Excel, Date ou string) para 'YYYY-MM-DD'.
function toIsoDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Epoch do Excel: 1899-12-30 (compensa o bug do ano-bissexto de 1900).
    const ms = Math.round(value) * 86_400_000
    const d = new Date(Date.UTC(1899, 11, 30) + ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  const s = cleanText(value)
  // dd/mm/yyyy -> yyyy-mm-dd
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/)
  if (iso) return s.slice(0, 10)
  return null
}

export type ImportTitularesResult = {
  inserted: number
  updated: number
  skipped: number
  errors: Array<{ row: number; reason: string }>
}

type ParsedRow = {
  uf: string
  municipio: string
  modalidade: string
  empreendimento: string
  mutuarioNome: string
  cpf: string
  pis: string | null
  dataAssinatura: string | null
  logradouro: string | null
  numeroImovel: string | null
  complemento: string // parte da identidade natural: sempre string (vazio = '')
  bairro: string | null
}

const MAX_ERRORS = 100

export async function importTitularesFromXlsx(input: {
  bytes: Uint8Array
  userId: string
}): Promise<ImportTitularesResult> {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(input.bytes, { type: 'array', cellDates: true })
  } catch {
    throw new ServiceError(400, 'Nao foi possivel ler o arquivo .xlsx.')
  }

  const sheetName = workbook.SheetNames[0]
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
  if (!sheet) {
    throw new ServiceError(400, 'Planilha vazia ou sem abas.')
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: true,
  })
  if (rows.length === 0) {
    throw new ServiceError(400, 'A planilha nao tem linhas de dados.')
  }

  // Valida o cabecalho (as chaves das linhas vem dos headers).
  const presentHeaders = new Set(Object.keys(rows[0] ?? {}))
  const missing = REQUIRED_HEADERS.filter((h) => !presentHeaders.has(h))
  if (missing.length > 0) {
    throw new ServiceError(
      400,
      `Cabecalho invalido. Colunas ausentes: ${missing.join(', ')}.`,
    )
  }

  const parsed: ParsedRow[] = []
  const errors: ImportTitularesResult['errors'] = []
  let skipped = 0

  rows.forEach((raw, index) => {
    const rowNo = index + 2 // +1 header, +1 base-1
    const cpf = normalizeCpf(padDigits11(cleanText(raw.Numero_CPF_Mutuario)))
    if (!isValidCpf(cpf)) {
      skipped++
      if (errors.length < MAX_ERRORS) {
        errors.push({ row: rowNo, reason: 'CPF invalido' })
      }
      return
    }
    const uf = cleanText(raw.UF)
    const municipio = cleanText(raw.Nome_Municipio)
    const modalidade = cleanText(raw.Nome_Modalidade)
    const empreendimento = cleanText(raw.Nome_Empreendimento)
    const mutuarioNome = cleanText(raw.Nome_do_Mutuario)
    if (!uf || !municipio || !modalidade || !empreendimento || !mutuarioNome) {
      skipped++
      if (errors.length < MAX_ERRORS) {
        errors.push({ row: rowNo, reason: 'Campos obrigatorios ausentes' })
      }
      return
    }
    parsed.push({
      uf,
      municipio,
      modalidade,
      empreendimento,
      mutuarioNome,
      cpf,
      pis: padDigits11(cleanText(raw.Numero_PIS_do_Mutuario)) || null,
      dataAssinatura: toIsoDate(raw.Data_da_Assinatura),
      logradouro: cleanText(raw.Nome_Logradouro_do_Imovel) || null,
      numeroImovel: cleanText(raw.Numero_Imovel) || null,
      complemento: cleanText(raw.Complemento_do_Imovel),
      bairro: cleanText(raw.Bairro_do_Imovel) || null,
    })
  })

  // Resolve o CONJUNTO (housing_complex) pelo `empreendimento`, com o mesmo match
  // normalizado dos processos (resolveHousingComplexIdOrThrow: upper(trim(...))).
  // Uma unica query carrega o registro (curado, pequeno) -> mapa em memoria. NAO
  // auto-cria conjunto: empreendimento sem match fica NULL (visivel so p/ admin).
  const complexes = await db
    .select({ id: housingComplex.id, name: housingComplex.name })
    .from(housingComplex)
  const complexIdByName = new Map(
    complexes.map((c) => [c.name.trim().toUpperCase(), c.id]),
  )
  const resolveConjunto = (empreendimento: string): string | null =>
    complexIdByName.get(empreendimento.trim().toUpperCase()) ?? null

  const importBatchId = crypto.randomUUID()
  let inserted = 0
  let updated = 0
  // Linhas recem-inseridas: unica fonte a enfileirar (novas nascem 'pending'). As
  // atualizadas preservam a quitacao ja resolvida — reconsulta e manual.
  const toEnqueue: Array<{ subjectId: string; cpf: string }> = []

  const CHUNK = 500
  for (let i = 0; i < parsed.length; i += CHUNK) {
    const slice = parsed.slice(i, i + CHUNK)
    const result = await db
      .insert(titularContratoCaixa)
      .values(
        slice.map((r) => ({
          id: crypto.randomUUID(),
          uf: r.uf,
          municipio: r.municipio,
          modalidade: r.modalidade,
          empreendimento: r.empreendimento,
          mutuarioNome: r.mutuarioNome,
          cpf: r.cpf,
          pis: r.pis,
          dataAssinatura: r.dataAssinatura,
          logradouro: r.logradouro,
          numeroImovel: r.numeroImovel,
          complemento: r.complemento,
          bairro: r.bairro,
          // Linha nova nasce 'pending' (sera enfileirada). Em conflito, NAO tocamos
          // a quitacao (nao esta no set do update abaixo).
          quitacaoStatus: 'pending' as const,
          housingComplexId: resolveConjunto(r.empreendimento),
          createdByUserId: input.userId,
          importBatchId,
        })),
      )
      .onConflictDoUpdate({
        // Identidade natural (cpf, empreendimento, complemento). complemento e
        // NOT NULL (vazio = '') para o upsert ser deterministico (ver schema).
        target: [
          titularContratoCaixa.cpf,
          titularContratoCaixa.empreendimento,
          titularContratoCaixa.complemento,
        ],
        set: {
          uf: sql`excluded.uf`,
          municipio: sql`excluded.municipio`,
          modalidade: sql`excluded.modalidade`,
          mutuarioNome: sql`excluded.mutuario_nome`,
          pis: sql`excluded.pis`,
          dataAssinatura: sql`excluded.data_assinatura`,
          logradouro: sql`excluded.logradouro`,
          numeroImovel: sql`excluded.numero_imovel`,
          bairro: sql`excluded.bairro`,
          // Reimport re-resolve o conjunto: pega conjuntos cadastrados DEPOIS do
          // primeiro import (empreendimento antes sem match passa a linkar).
          housingComplexId: sql`excluded.housing_complex_id`,
          importBatchId: sql`excluded.import_batch_id`,
          updatedAt: sql`now()`,
        },
      })
      .returning({
        id: titularContratoCaixa.id,
        cpf: titularContratoCaixa.cpf,
        // (xmax = 0) => a linha foi INSERIDA neste upsert (nao atualizada).
        isInsert: sql<boolean>`(xmax = 0)`,
      })

    for (const row of result) {
      if (row.isInsert) {
        inserted++
        toEnqueue.push({ subjectId: row.id, cpf: row.cpf })
      } else {
        updated++
      }
    }
  }

  if (toEnqueue.length > 0) {
    await enqueueManyQuitacao(
      toEnqueue.map((t) => ({
        subjectType: 'titular' as const,
        subjectId: t.subjectId,
        cpf: t.cpf,
      })),
    )
  }

  logEvent('titulares.import', {
    importBatchId,
    inserted,
    updated,
    skipped,
    enqueued: toEnqueue.length,
  })

  return { inserted, updated, skipped, errors }
}
