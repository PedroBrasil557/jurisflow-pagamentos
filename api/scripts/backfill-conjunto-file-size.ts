import { and, eq, gt, sql } from 'drizzle-orm'
import { env } from '../src/shared/config/env'
import { closeDb, db } from '../src/shared/db'
import {
  housingComplex,
  housingComplexFile,
} from '../src/modules/housing-complexes/housing-complexes.schema'
import { fitPdf } from '../src/shared/scan-enhance/client'
import {
  buildStorageObjectKey,
  deleteStorageObject,
  getStorageObjectBytes,
  storageBuckets,
  uploadStorageObject,
} from '../src/shared/storage/s3'

// Backfill: reduz para <= CHECKLIST_FILE_MAX_BYTES os PDFs de documento do
// CONJUNTO (housing_complex_file) que estao acima do limite. Esses arquivos sao
// espelhados (somente leitura) no checklist de TODOS os processos do conjunto e
// vao ao portal — um fit beneficia todos os processos daquele conjunto de uma vez.
//
// COMO: /fit do microservico (reduz-para-caber SEM realce). Grava NOVA REVISAO
// (is_current) mantendo o arquivo grande como is_current=false + replaced_at.
// A housing_complex_file NAO tem coluna `revision` nem tabela de history — a
// "revisao" e so is_current/replaced_at (indice unico parcial exige marcar a
// antiga is_current=false na MESMA transacao). uploadedByUserId = 'jurisflow-bot'.
//
// GUARDA: so grava se o resultado for MENOR e <= alvo. Docs nato-digitais que a
// rasterizacao nao encolhe (ou que nem cabem no piso) ficam INTACTOS e sao
// reportados. So PDFs entram (mime_type='application/pdf'); imagens sao puladas.
//
// DRY-RUN por padrao. --apply efetiva. Idempotente. Precisa de SCAN_ENHANCE_URL
// para --apply. Uso (a partir de api/), com DATABASE_URL de PROD + ENVIRONMENT=prod
// + SCAN_ENHANCE_URL:
//
//   ... bun run scripts/backfill-conjunto-file-size.ts              # dry-run
//   ... bun run scripts/backfill-conjunto-file-size.ts --apply      # grava
//
// Filtros opcionais:
//   --municipio JUAZEIRO   limita por housing_complex.city (case-insensitive)
//   --limit 10             processa no maximo N arquivos (rodada cautelosa)
//   --max-bytes 1900000    sobrepoe o alvo (default = env.checklistFileMaxBytes)

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i === -1 ? null : (process.argv[i + 1] ?? null)
}

const apply = process.argv.includes('--apply')
const municipio = argValue('--municipio')
const limit = Number(argValue('--limit')) || Number.POSITIVE_INFINITY
const maxBytes = Number(argValue('--max-bytes')) || env.checklistFileMaxBytes

// Copiado do housing-complexes.documents.service.ts (funcao privada) para manter
// a MESMA object key do upload do conjunto.
function sanitizeFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '')
  return cleaned || 'arquivo'
}

type TargetRow = {
  fileId: string
  housingComplexId: string
  documentTypeKey: string
  bucketName: string
  objectKey: string
  originalFileName: string
  sizeInBytes: number
  complexName: string
  city: string | null
}

async function loadTargets(): Promise<TargetRow[]> {
  const conditions = [
    eq(housingComplexFile.isCurrent, true),
    gt(housingComplexFile.sizeInBytes, maxBytes),
    eq(housingComplexFile.mimeType, 'application/pdf'),
  ]
  if (municipio) {
    conditions.push(sql`lower(${housingComplex.city}) = lower(${municipio})`)
  }

  return db
    .select({
      fileId: housingComplexFile.id,
      housingComplexId: housingComplexFile.housingComplexId,
      documentTypeKey: housingComplexFile.documentTypeKey,
      bucketName: housingComplexFile.bucketName,
      objectKey: housingComplexFile.objectKey,
      originalFileName: housingComplexFile.originalFileName,
      sizeInBytes: housingComplexFile.sizeInBytes,
      complexName: housingComplex.name,
      city: housingComplex.city,
    })
    .from(housingComplexFile)
    .innerJoin(
      housingComplex,
      eq(housingComplex.id, housingComplexFile.housingComplexId),
    )
    .where(and(...conditions))
    .orderBy(sql`${housingComplexFile.sizeInBytes} desc`)
}

const mb = (bytes: number) => (bytes / 1_000_000).toFixed(2)

function reportDryRun(rows: TargetRow[]) {
  const totalBytes = rows.reduce((sum, r) => sum + r.sizeInBytes, 0)
  console.log(
    `\nDocs de conjunto (PDF, is_current) > ${mb(maxBytes)} MB: ${rows.length} | soma ${mb(totalBytes)} MB`,
  )

  const byType = new Map<string, number>()
  const byComplex = new Map<string, number>()
  for (const r of rows) {
    byType.set(r.documentTypeKey, (byType.get(r.documentTypeKey) ?? 0) + 1)
    const c = `${r.complexName}${r.city ? ` (${r.city})` : ''}`
    byComplex.set(c, (byComplex.get(c) ?? 0) + 1)
  }
  console.log('\nPor tipo de documento:')
  for (const [k, n] of [...byType].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`)
  }
  console.log('\nPor conjunto (top 15):')
  for (const [c, n] of [...byComplex].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${c}: ${n}`)
  }
  console.log('\nMaiores (top 10):')
  for (const r of rows.slice(0, 10)) {
    console.log(
      `  ${mb(r.sizeInBytes)} MB  ${r.complexName}  ${r.documentTypeKey}`,
    )
  }
}

// Replica a escrita de nova corrente do uploadHousingComplexFile (sem revision,
// sem history): sobe o objeto ANTES da transacao; na transacao marca a corrente
// anterior is_current=false e insere a nova is_current=true.
async function writeNewRevision(row: TargetRow, newBytes: Uint8Array) {
  const newFileId = crypto.randomUUID()
  const bucketName = storageBuckets.processDocuments
  const objectKey = buildStorageObjectKey([
    'housing-complexes',
    row.housingComplexId,
    'documents',
    row.documentTypeKey,
    `${newFileId}-${sanitizeFileName(row.originalFileName)}`,
  ])

  await uploadStorageObject({
    body: newBytes,
    bucketName,
    contentType: 'application/pdf',
    objectKey,
  })

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(housingComplexFile)
        .set({ isCurrent: false, replacedAt: new Date() })
        .where(
          and(
            eq(housingComplexFile.housingComplexId, row.housingComplexId),
            eq(housingComplexFile.documentTypeKey, row.documentTypeKey),
            eq(housingComplexFile.isCurrent, true),
          ),
        )

      await tx.insert(housingComplexFile).values({
        id: newFileId,
        housingComplexId: row.housingComplexId,
        documentTypeKey: row.documentTypeKey,
        bucketName,
        objectKey,
        originalFileName: row.originalFileName,
        mimeType: 'application/pdf',
        sizeInBytes: newBytes.length,
        isCurrent: true,
        uploadedByUserId: 'jurisflow-bot',
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
  const failures: Array<{ complex: string; docType: string; error: string }> = []

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

      // Nao coube nem no piso: NAO grava (evita revisao ainda acima do limite).
      if (fittedLen > maxBytes) {
        needsManual.push(row)
        console.warn(
          `  [manual] ${row.complexName} ${row.documentTypeKey}: ${mb(row.sizeInBytes)} -> ${mb(fittedLen)} MB (ainda acima do limite)`,
        )
        continue
      }
      // Rasterizar nao ajudou (tipico de nato-digital): NAO grava, mantem original.
      if (fittedLen >= row.sizeInBytes) {
        noGain.push(row)
        continue
      }

      await writeNewRevision(row, result.bytes)
      compressed++
      bytesBefore += row.sizeInBytes
      bytesAfter += fittedLen
      console.log(
        `  [ok] ${row.complexName} ${row.documentTypeKey}: ${mb(row.sizeInBytes)} -> ${mb(fittedLen)} MB`,
      )
    } catch (error) {
      failures.push({
        complex: row.complexName,
        docType: row.documentTypeKey,
        error: String(error),
      })
      console.error(
        `  [erro] ${row.complexName} ${row.documentTypeKey}: ${String(error)}`,
      )
    }
  }

  console.log(
    `\nConcluido: ${compressed} recomprimido(s) (${mb(bytesBefore)} -> ${mb(bytesAfter)} MB), ` +
      `${needsManual.length} manual (nao coube no piso), ${noGain.length} sem ganho (nato-digital), ${failures.length} erro(s).`,
  )
  if (needsManual.length > 0) {
    console.log('\nPrecisam de tratamento manual (nao couberam nem no piso):')
    for (const r of needsManual) {
      console.log(
        `  ${r.complexName}  ${r.documentTypeKey}  ${mb(r.sizeInBytes)} MB`,
      )
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(closeDb)
