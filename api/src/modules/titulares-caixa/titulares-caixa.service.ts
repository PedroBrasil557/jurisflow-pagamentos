import {
  and,
  asc,
  desc,
  eq,
  exists,
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
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import type { ResolvedPermissions } from '../permissions/permissions.types'
import { enqueueQuitacao } from '../quitacao-queue/quitacao-queue.service'
import { buildTitularesVisibilityFilter } from './titulares-caixa.access'
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

// Constroi o WHERE dos filtros (compartilhado por listagem e export — garante que
// o Excel exportado bate exatamente com o que a tela mostra). O recorte de
// visibilidade por CONJUNTO (perms) entra aqui — substituiu o antigo recorte
// temporario de UF (BA/SP).
function buildTitularesWhere(
  query: ExportTitularesQuery,
  perms: ResolvedPermissions,
) {
  const filters = []

  // Recorte por permissao de conjunto (admin/all-scope = sem filtro).
  const visibility = buildTitularesVisibilityFilter(perms)
  if (visibility) {
    filters.push(visibility)
  }

  if (query.conjuntoIds?.length) {
    filters.push(
      inArray(titularContratoCaixa.housingComplexId, query.conjuntoIds),
    )
  }

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

export async function listTitulares(
  query: ListTitularesQuery,
  perms: ResolvedPermissions,
) {
  const whereClause = buildTitularesWhere(query, perms)
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
  perms: ResolvedPermissions,
): Promise<Uint8Array> {
  const whereClause = buildTitularesWhere(query, perms)
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

export async function listEmpreendimentoOptions(
  perms: ResolvedPermissions,
): Promise<{
  options: string[]
}> {
  const rows = await db
    .select({ value: titularContratoCaixa.empreendimento })
    .from(titularContratoCaixa)
    // So os conjuntos que o usuario ve (admin/all-scope = todos).
    .where(buildTitularesVisibilityFilter(perms))
    .groupBy(titularContratoCaixa.empreendimento)
    .orderBy(asc(titularContratoCaixa.empreendimento))
    .limit(EMPREENDIMENTO_OPTIONS_CAP)

  return { options: rows.map((r) => r.value) }
}

// Opcoes distintas de logradouro (mesmo padrao). logradouro e nullable, entao
// exclui NULL/vazio.
export async function listLogradouroOptions(
  perms: ResolvedPermissions,
): Promise<{ options: string[] }> {
  const rows = await db
    .select({ value: titularContratoCaixa.logradouro })
    .from(titularContratoCaixa)
    .where(
      and(
        buildTitularesVisibilityFilter(perms),
        sql`nullif(trim(${titularContratoCaixa.logradouro}), '') is not null`,
      ),
    )
    .groupBy(titularContratoCaixa.logradouro)
    .orderBy(asc(titularContratoCaixa.logradouro))
    .limit(EMPREENDIMENTO_OPTIONS_CAP)

  return { options: rows.map((r) => r.value).filter((v): v is string => !!v) }
}

// Opcoes distintas de CONJUNTO (housing_complex) presentes nos titulares visiveis
// — alimenta o filtro "Conjunto" do menu. Dirigido pela tabela PEQUENA de conjuntos
// + EXISTS (probe pelo indice titular_housing_complex_idx) em vez de GROUP BY sobre
// a tabela inteira de titulares (evita full scan). Titular sem conjunto nao casa
// nenhum housing_complex, entao naturalmente fica de fora.
export async function listConjuntoOptions(perms: ResolvedPermissions): Promise<{
  options: Array<{ id: string; nome: string }>
}> {
  const visibility = buildTitularesVisibilityFilter(perms)
  const rows = await db
    .select({ id: housingComplex.id, nome: housingComplex.name })
    .from(housingComplex)
    .where(
      exists(
        db
          .select({ one: sql`1` })
          .from(titularContratoCaixa)
          .where(
            and(
              eq(titularContratoCaixa.housingComplexId, housingComplex.id),
              visibility,
            ),
          ),
      ),
    )
    .orderBy(asc(housingComplex.name))
    .limit(EMPREENDIMENTO_OPTIONS_CAP)

  return { options: rows }
}

// Reconsulta manual: reenfileira os titulares selecionados com prioridade alta e
// volta a projecao para 'pending'. Idempotente (enqueue faz upsert por subject).
// Recorta pelos conjuntos visiveis ao usuario: ids fora do escopo sao ignorados
// (sem mutacao, sem job no portal, e o `enqueued` nao vira oraculo de existencia).
export async function reconsultarTitulares(
  ids: string[],
  perms: ResolvedPermissions,
): Promise<{ enqueued: number }> {
  const rows = await db
    .select({ id: titularContratoCaixa.id, cpf: titularContratoCaixa.cpf })
    .from(titularContratoCaixa)
    .where(
      and(
        inArray(titularContratoCaixa.id, ids),
        buildTitularesVisibilityFilter(perms),
      ),
    )

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

// Carrega o documento verificando que (a) pertence ao titular informado E (b) o
// titular esta num conjunto visivel ao usuario (join + buildTitularesVisibilityFilter).
// Fora do escopo => 404 (mesmo recorte da lista; nao vaza CPF/PIS/endereco do termo
// nem existencia). Espelha assertCanViewProcess dos processos.
async function loadTitularDocument(input: {
  titularId: string
  docId: string
  perms: ResolvedPermissions
}) {
  const [doc] = await db
    .select({
      storageKey: titularDocumento.storageKey,
      filename: titularDocumento.filename,
      contentType: titularDocumento.contentType,
    })
    .from(titularDocumento)
    .innerJoin(
      titularContratoCaixa,
      eq(titularContratoCaixa.id, titularDocumento.titularId),
    )
    .where(
      and(
        eq(titularDocumento.id, input.docId),
        eq(titularDocumento.titularId, input.titularId),
        buildTitularesVisibilityFilter(input.perms),
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
  perms: ResolvedPermissions
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
  perms: ResolvedPermissions
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
  perms: ResolvedPermissions
}): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
  const doc = await loadTitularDocument(input)
  const bytes = await getStorageObjectBytes({
    bucketName: storageBuckets.processDocuments,
    objectKey: doc.storageKey,
  })
  return { bytes, contentType: doc.contentType, filename: doc.filename }
}
