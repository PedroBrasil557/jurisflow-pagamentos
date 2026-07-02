import { and, eq, lt, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import {
  deleteStorageObject,
  importStagingPrefix,
  listStorageObjects,
  storageBuckets,
} from '../../shared/storage/s3'
import { process, processBatchFile, scanUpload } from './processes.schema'
import { deleteProcess } from './processes.service'

// GC de orfaos deixados por janelas de falha (crash entre copy e insert, presign
// sem complete, upload abandonado). Roda periodicamente no worker de ingestao.
// Conservador e best-effort: so remove o que e comprovadamente lixo e velho.

const HOUR_MS = 60 * 60 * 1000

// Idade minima para considerar algo abandonado. Alta o suficiente para nunca
// tocar em trabalho em voo (uploads levam segundos; ingestao, minutos).
// `globalThis.process`: neste modulo `process` e a TABELA (import abaixo), entao
// o global do Node e acessado explicitamente.
const ORPHAN_MIN_AGE_MS =
  Number(globalThis.process.env.GC_ORPHAN_MIN_AGE_HOURS ?? '48') * HOUR_MS

// Remove objetos de STAGING (imports/staging/, inclui scan-*) mais velhos que o
// TTL. Em prod o lifecycle do S3 ja faz isso; no MinIO (dev) e o unico GC.
async function sweepStagingObjects(cutoff: Date): Promise<number> {
  const bucketName = storageBuckets.processDocuments
  const objects = await listStorageObjects({
    bucketName,
    prefix: `${importStagingPrefix}/`,
  })
  let removed = 0
  for (const object of objects) {
    if (object.lastModified.getTime() >= cutoff.getTime()) {
      continue
    }
    try {
      await deleteStorageObject({ bucketName, objectKey: object.objectKey })
      removed += 1
    } catch (error) {
      console.error('gc: falha ao remover staging orfao', {
        objectKey: object.objectKey,
        error: String(error),
      })
    }
  }
  return removed
}

// Remove linhas scan_upload orfas (presign sem complete) mais velhas que o TTL.
async function sweepScanUploadRows(cutoff: Date): Promise<number> {
  const deleted = await db
    .delete(scanUpload)
    .where(lt(scanUpload.createdAt, cutoff))
    .returning({ uploadId: scanUpload.uploadId })
  return deleted.length
}

// Remove rascunhos RASCUNHO VAZIOS e velhos que nunca tiveram um arquivo de lote
// (id sem linha em process_batch_file) — cobre o presign/complete que criou o
// draft mas nunca ingeriu, e o crash entre copy e insert. `deleteProcess` limpa
// os objetos do processo por prefixo (inclui o PDF orfao com PII). Predicado
// conservador: sem identidade (cpf e nome vazios) e sem NENHUM arquivo de lote,
// entao um draft legitimo em uso (ou ja ingerido) nunca e apagado.
async function sweepEmptyDraftProcesses(cutoff: Date): Promise<number> {
  const candidates = await db
    .select({ id: process.id })
    .from(process)
    .where(
      and(
        eq(process.status, 'RASCUNHO'),
        lt(process.createdAt, cutoff),
        eq(process.fullName, ''),
        eq(process.cpf, ''),
        sql`not exists (select 1 from ${processBatchFile} where ${processBatchFile.processId} = ${process.id})`,
      ),
    )
    .limit(500)

  let removed = 0
  for (const candidate of candidates) {
    try {
      await deleteProcess(candidate.id)
      removed += 1
    } catch (error) {
      console.error('gc: falha ao remover rascunho orfao', {
        processId: candidate.id,
        error: String(error),
      })
    }
  }
  return removed
}

// Ponto de entrada do GC (chamado pelo worker). Best-effort: um erro numa etapa
// nao impede as outras nem derruba o worker.
export async function sweepOrphans(): Promise<void> {
  const cutoff = new Date(Date.now() - ORPHAN_MIN_AGE_MS)
  const results = { staging: 0, scanUploads: 0, drafts: 0 }
  try {
    results.staging = await sweepStagingObjects(cutoff)
  } catch (error) {
    console.error('gc: sweepStagingObjects falhou', { error: String(error) })
  }
  try {
    results.scanUploads = await sweepScanUploadRows(cutoff)
  } catch (error) {
    console.error('gc: sweepScanUploadRows falhou', { error: String(error) })
  }
  try {
    results.drafts = await sweepEmptyDraftProcesses(cutoff)
  } catch (error) {
    console.error('gc: sweepEmptyDraftProcesses falhou', {
      error: String(error),
    })
  }
  if (results.staging || results.scanUploads || results.drafts) {
    console.log('gc: orfaos removidos', results)
  }
}
