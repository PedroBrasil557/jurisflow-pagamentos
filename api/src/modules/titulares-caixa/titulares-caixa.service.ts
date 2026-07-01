import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import { normalizeCpf } from '../../shared/utils/cpf'
import {
  createStorageObjectDownloadUrl,
  createStorageObjectInlineUrl,
  storageBuckets,
} from '../../shared/storage/s3'
import { enqueueQuitacao } from '../quitacao-queue/quitacao-queue.service'
import type { ListTitularesQuery } from './titulares-caixa.schemas'
import {
  titularContratoCaixa,
  titularDocumento,
} from './titulares-caixa.schema'

// Prioridade da reconsulta manual: acima do lote de import (0) para o usuario ver
// o resultado antes da fila drenar.
const RECONSULT_PRIORITY = 100

export async function listTitulares(query: ListTitularesQuery) {
  const filters = []

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
  if (query.quitacaoStatuses?.length) {
    filters.push(
      inArray(titularContratoCaixa.quitacaoStatus, query.quitacaoStatuses),
    )
  }
  if (query.assinaturaFrom) {
    filters.push(gte(titularContratoCaixa.dataAssinatura, query.assinaturaFrom))
  }
  if (query.assinaturaTo) {
    filters.push(lte(titularContratoCaixa.dataAssinatura, query.assinaturaTo))
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined
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
    .groupBy(titularContratoCaixa.empreendimento)
    .orderBy(asc(titularContratoCaixa.empreendimento))
    .limit(EMPREENDIMENTO_OPTIONS_CAP)

  return { options: rows.map((r) => r.value) }
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
async function loadTitularDocument(input: { titularId: string; docId: string }) {
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
