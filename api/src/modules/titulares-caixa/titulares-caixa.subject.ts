import { eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import {
  buildStorageObjectKey,
  storageBuckets,
  uploadStorageObject,
} from '../../shared/storage/s3'
import { registerQuitacaoSubject } from '../quitacao-queue/quitacao-queue.subjects'
import {
  titularContratoCaixa,
  titularDocumento,
} from './titulares-caixa.schema'

// Handler do subject 'titular' para a fila de quitacao. Registrado no import
// (efeito colateral) — ver import em titulares-caixa.routes.

function normalizeFileName(fileName: string) {
  return (
    fileName
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9._-]/g, '') || 'termo-quitacao.pdf'
  )
}

registerQuitacaoSubject('titular', {
  async projectResult(titularId, projection) {
    // status null = retry em andamento: nao mexe na projecao (mantem 'pending').
    if (projection.status === null) return
    await db
      .update(titularContratoCaixa)
      .set({
        quitacaoStatus: projection.status,
        quitacaoMessage: projection.message ?? null,
        quitacaoLastCheckedAt: projection.checkedAt,
      })
      .where(eq(titularContratoCaixa.id, titularId))
  },

  async attachDocument(titularId, document) {
    const docId = crypto.randomUUID()
    const storageKey = buildStorageObjectKey([
      'titulares',
      titularId,
      'termo_quitacao',
      `${docId}-${normalizeFileName(document.filename)}`,
    ])

    await uploadStorageObject({
      body: document.bytes,
      bucketName: storageBuckets.processDocuments,
      contentType: document.contentType,
      objectKey: storageKey,
    })

    // Upsert por (titular, tipo): reanexo (retry) substitui os metadados em vez de
    // duplicar. (O objeto antigo no storage fica orfao; limpeza fica a cargo do
    // lifecycle do bucket — nao bloqueia o registro do novo termo.)
    await db
      .insert(titularDocumento)
      .values({
        id: docId,
        titularId,
        tipo: 'termo_quitacao',
        storageKey,
        filename: document.filename,
        contentType: document.contentType,
        size: document.bytes.byteLength,
        source: 'rpa',
      })
      .onConflictDoUpdate({
        target: [titularDocumento.titularId, titularDocumento.tipo],
        set: {
          storageKey: sql`excluded.storage_key`,
          filename: sql`excluded.filename`,
          contentType: sql`excluded.content_type`,
          size: sql`excluded.size`,
          source: sql`excluded.source`,
          createdAt: sql`now()`,
        },
      })
  },
})
