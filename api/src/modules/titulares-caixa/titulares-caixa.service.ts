import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from 'drizzle-orm'
import * as XLSX from 'xlsx'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import {
  createStorageObjectDownloadUrl,
  createStorageObjectInlineUrl,
  getStorageObjectBytes,
  storageBuckets,
} from '../../shared/storage/s3'
import { formatCpf, normalizeCpf } from '../../shared/utils/cpf'
import { enqueueQuitacao } from '../quitacao-queue/quitacao-queue.service'
import {
  titularContratoCaixa,
  titularDocumento,
} from './titulares-caixa.schema'
import type {
  ExportTitularesQuery,
  ListTitularesQuery,
} from './titulares-caixa.schemas'

// Prioridade da reconsulta manual: acima do lote de import (0) para o usuario ver
// o resultado antes da fila drenar.
const RECONSULT_PRIORITY = 100

// TEMPORARIO: a tela de Titulares Caixa (lista, export e opcoes de filtro) mostra
// apenas a Bahia por enquanto. Remover quando a permissao por estado for
// implementada (o recorte de UF passa a vir dos estados permitidos do usuario).
const TITULARES_UF_TEMPORARIA = 'BA'

// Constroi o WHERE dos filtros (compartilhado por listagem e export — garante que
// o Excel exportado bate exatamente com o que a tela mostra).
function buildTitularesWhere(query: ExportTitularesQuery) {
  const filters = []

  // TEMPORARIO: trava o recorte na Bahia (ver TITULARES_UF_TEMPORARIA).
  filters.push(eq(titularContratoCaixa.uf, TITULARES_UF_TEMPORARIA))

  if (query.search) {
    const term = `%${query.search}%`
    const digits = normalizeCpf(query.search)
    filters.push(
      digits
        ? or(
            ilike(titularContratoCaixa.mutuarioNome, term),
            ilike(titularContratoCaixa.cpf, `%${digits}%`),
          )
        : ilike(titularContratoCaixa.mutuarioNome, term),
    )
  }
  if (query.uf?.length) {
    filters.push(inArray(titularContratoCaixa.uf, query.uf))
  }
  if (query.municipio) {
    filters.push(ilike(titularContratoCaixa.municipio, `%${query.municipio}%`))
  }
  if (query.modalidade?.length) {
    filters.push(inArray(titularContratoCaixa.modalidade, query.modalidade))
  }
  if (query.empreendimento?.length) {
    filters.push(
      inArray(titularContratoCaixa.empreendimento, query.empreendimento),
    )
  }
  if (query.logradouros?.length) {
    filters.push(inArray(titularContratoCaixa.logradouro, query.logradouros))
  }
  if (query.quitacaoStatuses?.length) {
    filters.push(
      inArray(titularContratoCaixa.quitacaoStatus, query.quitacaoStatuses),
    )
  }
  if (query.averbacoes?.length) {
    filters.push(inArray(titularContratoCaixa.averbacao, query.averbacoes))
  }
  if (query.assinaturaFrom) {
    filters.push(gte(titularContratoCaixa.dataAssinatura, query.assinaturaFrom))
  }
  if (query.assinaturaTo) {
    filters.push(lte(titularContratoCaixa.dataAssinatura, query.assinaturaTo))
  }

  return filters.length > 0 ? and(...filters) : undefined
}

export async function listTitulares(query: ListTitularesQuery) {
  const whereClause = buildTitularesWhere(query)
  const offset = (query.page - 1) * query.limit

  const [items, [summary]] = await Promise.all([
    db
      .select({
        id: titularContratoCaixa.id,
        uf: titularContratoCaixa.uf,
        municipio: titularContratoCaixa.municipio,
        modalidade: titularContratoCaixa.modalidade,
        empreendimento: titularContratoCaixa.empreendimento,
        mutuarioNome: titularContratoCaixa.mutuarioNome,
        cpf: titularContratoCaixa.cpf,
        pis: titularContratoCaixa.pis,
        dataAssinatura: titularContratoCaixa.dataAssinatura,
        logradouro: titularContratoCaixa.logradouro,
        numeroImovel: titularContratoCaixa.numeroImovel,
        complemento: titularContratoCaixa.complemento,
        bairro: titularContratoCaixa.bairro,
        quitacaoStatus: titularContratoCaixa.quitacaoStatus,
        quitacaoMessage: titularContratoCaixa.quitacaoMessage,
        quitacaoLastCheckedAt: titularContratoCaixa.quitacaoLastCheckedAt,
        averbacao: titularContratoCaixa.averbacao,
        // Id do termo de quitacao anexado (null = sem documento) para o botao "Baixar".
        termoDocId: titularDocumento.id,
      })
      .from(titularContratoCaixa)
      .leftJoin(
        titularDocumento,
        and(
          eq(titularDocumento.titularId, titularContratoCaixa.id),
          eq(titularDocumento.tipo, 'termo_quitacao'),
        ),
      )
      .where(whereClause)
      .orderBy(desc(titularContratoCaixa.createdAt))
      .limit(query.limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(titularContratoCaixa)
      .where(whereClause),
  ])

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total: summary?.total ?? 0,
    },
  }
}

// ---- Export Excel (respeita os mesmos filtros da listagem) ----
const EXPORT_ROW_CAP = 50_000

const quitacaoExportLabel: Record<string, string> = {
  idle: 'Sem consulta',
  pending: 'Pendente',
  quitado: 'Quitado',
  nao_encontrado: 'Nao encontrado',
  erro: 'Erro',
}
const averbacaoExportLabel: Record<string, string> = {
  sim: 'Sim',
  nao: 'Nao',
  indeterminado: 'Indeterminado',
}

function fmtIsoDate(iso: string | null): string {
  if (!iso) return ''
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}
function fmtDateTime(d: Date | null): string {
  if (!d) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export async function exportTitulares(
  query: ExportTitularesQuery,
): Promise<Uint8Array> {
  const whereClause = buildTitularesWhere(query)
  const rows = await db
    .select({
      uf: titularContratoCaixa.uf,
      municipio: titularContratoCaixa.municipio,
      modalidade: titularContratoCaixa.modalidade,
      empreendimento: titularContratoCaixa.empreendimento,
      mutuarioNome: titularContratoCaixa.mutuarioNome,
      cpf: titularContratoCaixa.cpf,
      pis: titularContratoCaixa.pis,
      dataAssinatura: titularContratoCaixa.dataAssinatura,
      logradouro: titularContratoCaixa.logradouro,
      numeroImovel: titularContratoCaixa.numeroImovel,
      complemento: titularContratoCaixa.complemento,
      bairro: titularContratoCaixa.bairro,
      quitacaoStatus: titularContratoCaixa.quitacaoStatus,
      averbacao: titularContratoCaixa.averbacao,
      quitacaoLastCheckedAt: titularContratoCaixa.quitacaoLastCheckedAt,
      termoDocId: titularDocumento.id,
    })
    .from(titularContratoCaixa)
    .leftJoin(
      titularDocumento,
      and(
        eq(titularDocumento.titularId, titularContratoCaixa.id),
        eq(titularDocumento.tipo, 'termo_quitacao'),
      ),
    )
    .where(whereClause)
    .orderBy(
      asc(titularContratoCaixa.empreendimento),
      asc(titularContratoCaixa.mutuarioNome),
    )
    .limit(EXPORT_ROW_CAP)

  const data = rows.map((r) => ({
    UF: r.uf,
    Municipio: r.municipio,
    Modalidade: r.modalidade,
    Empreendimento: r.empreendimento,
    Nome: r.mutuarioNome,
    CPF: formatCpf(r.cpf),
    PIS: r.pis ?? '',
    'Data de assinatura': fmtIsoDate(r.dataAssinatura),
    Logradouro: r.logradouro ?? '',
    Numero: r.numeroImovel ?? '',
    Complemento: r.complemento,
    Bairro: r.bairro ?? '',
    Quitacao: quitacaoExportLabel[r.quitacaoStatus] ?? r.quitacaoStatus,
    Averbacao: r.averbacao ? (averbacaoExportLabel[r.averbacao] ?? '') : '',
    'Consultado em': fmtDateTime(r.quitacaoLastCheckedAt),
    'Tem termo': r.termoDocId ? 'Sim' : 'Nao',
  }))

  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Titulares')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return new Uint8Array(buf)
}

// Opcoes distintas de empreendimento (para o filtro multiselect). Volume baixo
// (dezenas), entao retorna todos os distintos ordenados — sem paginacao/busca no
// servidor (o multiselect filtra client-side). Teto de seguranca em 1000.
const EMPREENDIMENTO_OPTIONS_CAP = 1000

export async function listEmpreendimentoOptions(): Promise<{
  options: string[]
}> {
  const rows = await db
    .select({ value: titularContratoCaixa.empreendimento })
    .from(titularContratoCaixa)
    // TEMPORARIO: so a Bahia (ver TITULARES_UF_TEMPORARIA).
    .where(eq(titularContratoCaixa.uf, TITULARES_UF_TEMPORARIA))
    .groupBy(titularContratoCaixa.empreendimento)
    .orderBy(asc(titularContratoCaixa.empreendimento))
    .limit(EMPREENDIMENTO_OPTIONS_CAP)

  return { options: rows.map((r) => r.value) }
}

// Opcoes distintas de logradouro (mesmo padrao). logradouro e nullable, entao
// exclui NULL/vazio.
export async function listLogradouroOptions(): Promise<{ options: string[] }> {
  const rows = await db
    .select({ value: titularContratoCaixa.logradouro })
    .from(titularContratoCaixa)
    // TEMPORARIO: so a Bahia (ver TITULARES_UF_TEMPORARIA).
    .where(
      and(
        eq(titularContratoCaixa.uf, TITULARES_UF_TEMPORARIA),
        sql`nullif(trim(${titularContratoCaixa.logradouro}), '') is not null`,
      ),
    )
    .groupBy(titularContratoCaixa.logradouro)
    .orderBy(asc(titularContratoCaixa.logradouro))
    .limit(EMPREENDIMENTO_OPTIONS_CAP)

  return { options: rows.map((r) => r.value).filter((v): v is string => !!v) }
}

// Reconsulta manual: reenfileira os titulares selecionados com prioridade alta e
// volta a projecao para 'pending'. Idempotente (enqueue faz upsert por subject).
export async function reconsultarTitulares(
  ids: string[],
): Promise<{ enqueued: number }> {
  const rows = await db
    .select({ id: titularContratoCaixa.id, cpf: titularContratoCaixa.cpf })
    .from(titularContratoCaixa)
    .where(inArray(titularContratoCaixa.id, ids))

  for (const row of rows) {
    await enqueueQuitacao({
      subjectType: 'titular',
      subjectId: row.id,
      cpf: row.cpf,
      priority: RECONSULT_PRIORITY,
    })
  }
  if (rows.length > 0) {
    await db
      .update(titularContratoCaixa)
      .set({ quitacaoStatus: 'pending', quitacaoMessage: null })
      .where(
        inArray(
          titularContratoCaixa.id,
          rows.map((r) => r.id),
        ),
      )
  }

  return { enqueued: rows.length }
}

// URL pre-assinada de download do documento (verifica que pertence ao titular).
async function loadTitularDocument(input: {
  titularId: string
  docId: string
}) {
  const [doc] = await db
    .select({
      storageKey: titularDocumento.storageKey,
      filename: titularDocumento.filename,
      contentType: titularDocumento.contentType,
    })
    .from(titularDocumento)
    .where(
      and(
        eq(titularDocumento.id, input.docId),
        eq(titularDocumento.titularId, input.titularId),
      ),
    )
    .limit(1)

  if (!doc) {
    throw new ServiceError(404, 'Documento nao encontrado.')
  }
  return doc
}

export async function getTitularDocumentDownloadUrl(input: {
  titularId: string
  docId: string
}): Promise<string> {
  const doc = await loadTitularDocument(input)
  return createStorageObjectDownloadUrl({
    bucketName: storageBuckets.processDocuments,
    objectKey: doc.storageKey,
    downloadFileName: doc.filename,
  })
}

// URL de VISUALIZACAO inline (preview no navegador, sem download).
export async function getTitularDocumentInlineUrl(input: {
  titularId: string
  docId: string
}): Promise<string> {
  const doc = await loadTitularDocument(input)
  return createStorageObjectInlineUrl({
    bucketName: storageBuckets.processDocuments,
    objectKey: doc.storageKey,
    contentType: doc.contentType,
  })
}

// Bytes do documento (streaming SAME-ORIGIN pela API). Usado pelo viewer de PDF
// (react-pdf/pdfjs faz range requests; servir same-origin evita CORS/redirect ao
// MinIO que o preview por URL pre-assinada teria).
export async function getTitularDocumentBytes(input: {
  titularId: string
  docId: string
}): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
  const doc = await loadTitularDocument(input)
  const bytes = await getStorageObjectBytes({
    bucketName: storageBuckets.processDocuments,
    objectKey: doc.storageKey,
  })
  return { bytes, contentType: doc.contentType, filename: doc.filename }
}
