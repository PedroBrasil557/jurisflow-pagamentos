import { and, eq, gt, notInArray, sql } from 'drizzle-orm'
import { env } from '../src/shared/config/env'
import { closeDb, db } from '../src/shared/db'
import { createProcessHistoryEntry } from '../src/modules/processes/processes.history.service'
import {
  process as processTable,
  processDocument,
  processDocumentFile,
  processDocumentType,
} from '../src/modules/processes/processes.schema'
import { fitPdf } from '../src/shared/scan-enhance/client'
import {
  buildProcessDocumentObjectKey,
  deleteStorageObject,
  getStorageObjectBytes,
  storageBuckets,
  uploadStorageObject,
} from '../src/shared/storage/s3'

// Backfill: reduz para <= CHECKLIST_FILE_MAX_BYTES os PDFs de documento JA
// anexados no checklist que estao acima do limite (o portal rejeita arquivos
// grandes). So o novo fluxo de scan ja nasce dentro do limite; este script
// resolve o acervo legado.
//
// COMO: /fit do microservico (reduz-para-caber SEM realce — um scan legado ja
// foi realcado; re-realcar super-processaria). Grava como NOVA REVISAO
// (is_current) e mantem o arquivo grande como revisao antiga (is_current=false,
// replaced_at) — audit-safe e reversivel. NAO dispara re-extracao por IA nem
// reconcilia status (o conteudo do documento nao muda, so o tamanho).
//
// ESCOPO: todos os documentos com file.is_current e size_in_bytes > alvo, PULANDO
// processos terminais (FINALIZADO/CANCELADO, read-only/ja resolvidos).
//
// DRY-RUN por padrao (nao grava). --apply efetiva. Idempotente: re-rodar so pega
// o que ainda estiver acima do alvo. Precisa de SCAN_ENHANCE_URL para --apply.
//
// Uso (a partir de api/), com DATABASE_URL de PROD e ENVIRONMENT=prod (TLS do
// RDS) e SCAN_ENHANCE_URL apontando para o microservico:
//
//   DATABASE_URL=postgresql://...jurisflow ENVIRONMENT=prod \
//     SCAN_ENHANCE_URL=http://scan-enhance:8000 \
//     bun run scripts/backfill-checklist-file-size.ts                 # dry-run
//   ... --apply                                                       # grava
//
// Filtros opcionais:
//   --municipio JUAZEIRO   limita a uma cidade (process.city, case-insensitive)
//   --cpf 56476604520      um unico processo (para testar)
//   --limit 10             processa no maximo N arquivos (primeira rodada cautelosa)
//   --max-bytes 1900000    sobrepoe o alvo (default = env.checklistFileMaxBytes)

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i === -1 ? null : (process.argv[i + 1] ?? null)
}

const apply = process.argv.includes('--apply')
const municipio = argValue('--municipio')
const cpf = argValue('--cpf')?.replace(/\D/g, '') || null
const limit = Number(argValue('--limit')) || Number.POSITIVE_INFINITY
const maxBytes = Number(argValue('--max-bytes')) || env.checklistFileMaxBytes

// Terminais: read-only e normalmente ja protocolados/resolvidos.
const TERMINAL_STATUSES = ['FINALIZADO', 'CANCELADO'] as const

type TargetRow = {
  fileId: string
  processDocumentId: string
  bucketName: string
  objectKey: string
  originalFileName: string
  sizeInBytes: number
  processId: string
  processStatus: string
  processCode: string
  city: string | null
  docTypeKey: string
  docTypeLabel: string
  docTypeSortOrder: number
}

async function loadTargets(): Promise<TargetRow[]> {
  const conditions = [
    eq(processDocumentFile.isCurrent, true),
    gt(processDocumentFile.sizeInBytes, maxBytes),
    notInArray(processTable.status, [...TERMINAL_STATUSES]),
  ]
  if (municipio) {
    conditions.push(sql`lower(${processTable.city}) = lower(${municipio})`)
  }
  if (cpf) {
    conditions.push(
      sql`regexp_replace(${processTable.cpf}, '\\D', '', 'g') = ${cpf}`,
    )
  }

  return db
    .select({
      fileId: processDocumentFile.id,
      processDocumentId: processDocumentFile.processDocumentId,
      bucketName: processDocumentFile.bucketName,
      objectKey: processDocumentFile.objectKey,
      originalFileName: processDocumentFile.originalFileName,
      sizeInBytes: processDocumentFile.sizeInBytes,
      processId: processDocument.processId,
      processStatus: processTable.status,
      processCode: processTable.code,
      city: processTable.city,
      docTypeKey: processDocumentType.key,
      docTypeLabel: processDocumentType.label,
      docTypeSortOrder: processDocumentType.sortOrder,
    })
    .from(processDocumentFile)
    .innerJoin(
      processDocument,
      eq(processDocument.id, processDocumentFile.processDocumentId),
    )
    .innerJoin(
      processDocumentType,
      eq(processDocumentType.id, processDocument.documentTypeId),
    )
    .innerJoin(processTable, eq(processTable.id, processDocument.processId))
    .where(and(...conditions))
    .orderBy(sql`${processDocumentFile.sizeInBytes} desc`)
}

const mb = (bytes: number) => (bytes / 1_000_000).toFixed(2)

function reportDryRun(rows: TargetRow[]) {
  const totalBytes = rows.reduce((sum, r) => sum + r.sizeInBytes, 0)
  console.log(
    `\nArquivos > ${mb(maxBytes)} MB (is_current, sem terminais): ${rows.length} | soma ${mb(totalBytes)} MB`,
  )

  const byStatus = new Map<string, number>()
  const byType = new Map<string, number>()
  for (const r of rows) {
    byStatus.set(r.processStatus, (byStatus.get(r.processStatus) ?? 0) + 1)
    byType.set(r.docTypeKey, (byType.get(r.docTypeKey) ?? 0) + 1)
  }
  console.log('\nPor status:')
  for (const [s, n] of [...byStatus].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`)
  }
  console.log('\nPor tipo de documento (top 10):')
  for (const [k, n] of [...byType].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${k}: ${n}`)
  }
  console.log('\nMaiores (top 10):')
  for (const r of rows.slice(0, 10)) {
    console.log(
      `  ${mb(r.sizeInBytes)} MB  ${r.processCode}  ${r.docTypeKey}  (${r.processStatus})`,
    )
  }
}

async function writeNewRevision(row: TargetRow, newBytes: Uint8Array) {
  const newFileId = crypto.randomUUID()
  const objectKey = buildProcessDocumentObjectKey({
    processId: row.processId,
    documentTypeKey: row.docTypeKey,
    documentTypeSortOrder: row.docTypeSortOrder,
    documentTypeLabel: row.docTypeLabel,
    fileId: newFileId,
    fileName: row.originalFileName,
  })
  const uploadedAt = new Date()
  const bucketName = storageBuckets.processDocuments

  // Sobe o objeto novo ANTES da transacao (igual ao attachChecklistFile); se a
  // transacao falhar, remove o objeto orfao.
  await uploadStorageObject({
    bucketName,
    objectKey,
    contentType: 'application/pdf',
    body: newBytes,
  })

  try {
    await db.transaction(async (tx) => {
      const [rev] = await tx
        .select({
          maxRevision: sql<number>`coalesce(max(${processDocumentFile.revision}), 0)::int`,
        })
        .from(processDocumentFile)
        .where(eq(processDocumentFile.processDocumentId, row.processDocumentId))
      const nextRevision = (rev?.maxRevision ?? 0) + 1

      await tx
        .update(processDocumentFile)
        .set({ isCurrent: false, replacedAt: uploadedAt })
        .where(
          and(
            eq(processDocumentFile.processDocumentId, row.processDocumentId),
            eq(processDocumentFile.isCurrent, true),
          ),
        )

      await tx.insert(processDocumentFile).values({
        id: newFileId,
        processDocumentId: row.processDocumentId,
        bucketName,
        objectKey,
        originalFileName: row.originalFileName,
        mimeType: 'application/pdf',
        sizeInBytes: newBytes.length,
        revision: nextRevision,
        isCurrent: true,
        uploadedByUserId: 'jurisflow-bot',
        uploadedAt,
        replacedAt: null,
      })

      await createProcessHistoryEntry({
        processId: row.processId,
        actorUserId: 'jurisflow-bot',
        eventType: 'DOCUMENT_REPLACED',
        notes: `Backfill de tamanho: ${row.docTypeLabel} recomprimido de ${mb(row.sizeInBytes)} MB para ${mb(newBytes.length)} MB (limite ${mb(maxBytes)} MB).`,
        executor: tx,
      })
    })
  } catch (error) {
    await deleteStorageObject({ bucketName, objectKey }).catch(() => {})
    throw error
  }
}

async function main() {
  console.log(
    `Alvo por arquivo: ${mb(maxBytes)} MB (${maxBytes} bytes)` +
      (municipio ? ` | municipio=${municipio}` : '') +
      (cpf ? ` | cpf=${cpf}` : '') +
      (Number.isFinite(limit) ? ` | limit=${limit}` : ''),
  )

  const all = await loadTargets()
  const rows = Number.isFinite(limit) ? all.slice(0, limit) : all
  reportDryRun(rows)

  if (!apply) {
    console.log(
      '\nDRY-RUN — nada foi gravado. Rode de novo com --apply para efetivar.',
    )
    return
  }

  if (!env.scanEnhanceUrl) {
    throw new Error(
      'SCAN_ENHANCE_URL nao configurado — obrigatorio para --apply (o /fit roda no microservico).',
    )
  }

  console.log(`\n--apply: processando ${rows.length} arquivo(s)...`)
  let compressed = 0
  let bytesBefore = 0
  let bytesAfter = 0
  const needsManual: TargetRow[] = []
  const noGain: TargetRow[] = []
  const failures: Array<{ code: string; docType: string; error: string }> = []

  for (const row of rows) {
    try {
      const original = await getStorageObjectBytes({
        bucketName: row.bucketName,
        objectKey: row.objectKey,
      })
      const result = await fitPdf(new Uint8Array(original), maxBytes)
      if (!result) {
        throw new Error('fitPdf retornou null (SCAN_ENHANCE_URL desligado)')
      }
      const fittedLen = result.bytes.length

      // Nao coube nem no piso: NAO grava (evita revisao que continua acima do
      // limite) — reporta para tratamento manual (re-escanear menos paginas etc.).
      if (fittedLen > maxBytes) {
        needsManual.push(row)
        console.warn(
          `  [manual] ${row.processCode} ${row.docTypeKey}: ${mb(row.sizeInBytes)} -> ${mb(fittedLen)} MB (ainda acima do limite)`,
        )
        continue
      }
      // Sem ganho real (nao deveria acontecer): pula.
      if (fittedLen >= row.sizeInBytes) {
        noGain.push(row)
        continue
      }

      await writeNewRevision(row, result.bytes)
      compressed++
      bytesBefore += row.sizeInBytes
      bytesAfter += fittedLen
      console.log(
        `  [ok] ${row.processCode} ${row.docTypeKey}: ${mb(row.sizeInBytes)} -> ${mb(fittedLen)} MB`,
      )
    } catch (error) {
      failures.push({
        code: row.processCode,
        docType: row.docTypeKey,
        error: String(error),
      })
      console.error(`  [erro] ${row.processCode} ${row.docTypeKey}: ${String(error)}`)
    }
  }

  console.log(
    `\nConcluido: ${compressed} recomprimido(s) (${mb(bytesBefore)} -> ${mb(bytesAfter)} MB), ` +
      `${needsManual.length} manual (nao coube no piso), ${noGain.length} sem ganho, ${failures.length} erro(s).`,
  )
  if (needsManual.length > 0) {
    console.log('\nPrecisam de tratamento manual (nao couberam nem no piso):')
    for (const r of needsManual) {
      console.log(`  ${r.processCode}  ${r.docTypeKey}  ${mb(r.sizeInBytes)} MB`)
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(closeDb)
