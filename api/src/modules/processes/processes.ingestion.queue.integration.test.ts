import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../../shared/db'
import { user } from '../auth/auth.schema'
import {
  claimNextIngestionJob,
  deadLetterIngestion,
  failIngestion,
  INGESTION_MAX_FAILURES,
  markIngestionDone,
  renewIngestionLease,
} from './processes.ingestion.queue'
import { processBatchFile, process as processTable } from './processes.schema'

// Testes de INTEGRACAO da fila de ingestao — exigem Postgres real (claim com
// FOR UPDATE SKIP LOCKED, lease, fencing nao dao para testar sem DB). Rodam SO com
// RUN_INTEGRATION=1 (e DATABASE_URL apontando para um banco isolado sem worker),
// via `bun run test:integration`. Sem a flag, o suite inteiro e pulado — `bun test`
// padrao continua sem dependencia de banco.
const RUN = process.env.RUN_INTEGRATION === '1'
const suite = RUN ? describe : describe.skip

suite('fila de ingestao (integracao Postgres)', () => {
  const userId = `test-user-${crypto.randomUUID()}`
  const processId = `test-proc-${crypto.randomUUID()}`

  beforeAll(async () => {
    await db.insert(user).values({
      id: userId,
      name: 'Teste Integracao',
      email: `${userId}@test.local`,
    })
    await db.insert(processTable).values({
      id: processId,
      code: `TEST-${crypto.randomUUID().slice(0, 8)}`,
      fullName: '',
      nationality: '',
      maritalStatus: '',
      profession: '',
      ownerType: '',
      cpf: '',
      rg: '',
      cadunico: '',
      propertyPaidOff: '',
      state: '',
      city: '',
      district: '',
      housingComplex: '',
      street: '',
      number: '',
      complement: '',
      zipcode: '',
      email: '',
      whatsapp: '',
      observation: '',
      createdByUserId: userId,
    })
  })

  afterEach(async () => {
    // Determinismo: o claim pega o proximo job ELEGIVEL da tabela. Limpa os jobs
    // entre testes para um nao herdar 'queued'/'processing' de outro.
    await db
      .delete(processBatchFile)
      .where(eq(processBatchFile.processId, processId))
  })

  afterAll(async () => {
    await db.delete(processTable).where(eq(processTable.id, processId)) // cascade
    await db.delete(user).where(eq(user.id, userId))
    await (
      globalThis as typeof globalThis & {
        __apiPool?: { end: () => Promise<void> }
      }
    ).__apiPool?.end()
  })

  async function insertJob(
    overrides: Partial<typeof processBatchFile.$inferInsert> = {},
  ): Promise<string> {
    const id = `test-bf-${crypto.randomUUID()}`
    await db.insert(processBatchFile).values({
      id,
      processId,
      bucketName: 'test-bucket',
      objectKey: `test/${id}.pdf`,
      originalFileName: 'test.pdf',
      mimeType: 'application/pdf',
      sizeInBytes: 1,
      uploadedByUserId: userId,
      splitStatus: 'queued',
      splitUpdatedAt: new Date(),
      ...overrides,
    })
    return id
  }

  async function getJob(id: string) {
    const [row] = await db
      .select()
      .from(processBatchFile)
      .where(eq(processBatchFile.id, id))
      .limit(1)
    return row
  }

  test('claim reivindica um job queued, incrementa deliveryCount e grava lease+token', async () => {
    const id = await insertJob()

    const job = await claimNextIngestionJob()

    expect(job?.batchFileId).toBe(id)
    expect(job?.deliveryCount).toBe(1)
    expect(job?.failureCount).toBe(0)
    expect(job?.leaseToken).toBeTruthy()

    const row = await getJob(id)
    expect(row.splitStatus).toBe('processing')
    expect(row.splitLeaseExpiresAt).not.toBeNull()
    expect(row.splitLeaseToken).toBe(job?.leaseToken ?? '')
  })

  test('SKIP LOCKED: dois claims concorrentes nao pegam o mesmo job', async () => {
    await insertJob()

    const [a, b] = await Promise.all([
      claimNextIngestionJob(),
      claimNextIngestionJob(),
    ])

    const claimed = [a, b].filter(Boolean)
    expect(claimed).toHaveLength(1)
  })

  test('claim reivindica processing com lease EXPIRADO (orfao)', async () => {
    const id = await insertJob({
      splitStatus: 'processing',
      splitLeaseExpiresAt: new Date(Date.now() - 1000),
      splitLeaseToken: 'token-antigo',
      splitDeliveryCount: 1,
    })

    const job = await claimNextIngestionJob()

    expect(job?.batchFileId).toBe(id)
    expect(job?.deliveryCount).toBe(2)
    expect(job?.leaseToken).not.toBe('token-antigo')
  })

  test('claim NAO reivindica processing com lease VIVO', async () => {
    await insertJob({
      splitStatus: 'processing',
      splitLeaseExpiresAt: new Date(Date.now() + 60_000),
      splitLeaseToken: 'token-vivo',
      splitDeliveryCount: 1,
    })

    const job = await claimNextIngestionJob()

    expect(job).toBeNull()
  })

  test('claim NAO reivindica job queued com backoff pendente', async () => {
    await insertJob({
      splitStatus: 'queued',
      splitLeaseExpiresAt: new Date(Date.now() + 60_000), // elegivel-a-partir-de futuro
    })

    const job = await claimNextIngestionJob()

    expect(job).toBeNull()
  })

  test('markIngestionDone respeita o fencing token', async () => {
    const id = await insertJob()
    const job = await claimNextIngestionJob()

    // Token errado: no-op (continua processing) e RETORNA false — o caller usa
    // isso para nao logar um 'done' falso (observabilidade) quando o lease foi
    // perdido para outra replica.
    expect(
      await markIngestionDone(id, 'token-errado', 'nao deveria valer'),
    ).toBe(false)
    expect((await getJob(id)).splitStatus).toBe('processing')

    // Token certo: conclui e RETORNA true (aplicou de fato).
    expect(await markIngestionDone(id, job?.leaseToken ?? '', 'ok')).toBe(true)
    const row = await getJob(id)
    expect(row.splitStatus).toBe('done')
    expect(row.splitLeaseToken).toBeNull()
  })

  test('failIngestion com orcamento restante volta para queued com backoff e incrementa falhas', async () => {
    const id = await insertJob()
    const job = await claimNextIngestionJob() // failureCount = 0

    expect(
      await failIngestion(
        id,
        job?.leaseToken ?? '',
        job?.failureCount ?? 0,
        'transitorio',
      ),
    ).toBe(true)

    const row = await getJob(id)
    expect(row.splitStatus).toBe('queued')
    expect(row.splitFailureCount).toBe(1) // falha registrada
    expect(row.splitLeaseExpiresAt).not.toBeNull() // backoff (elegivel-a-partir-de)
    expect(row.splitDeadLetterAt).toBeNull()
  })

  test('failIngestion com orcamento de falhas esgotado vai para dead-letter (error)', async () => {
    // Ja falhou ate o limite-1; a proxima falha estoura o orcamento de retry.
    const id = await insertJob({
      splitFailureCount: INGESTION_MAX_FAILURES - 1,
    })
    const job = await claimNextIngestionJob() // failureCount = MAX-1

    expect(
      await failIngestion(
        id,
        job?.leaseToken ?? '',
        job?.failureCount ?? 0,
        'veneno',
      ),
    ).toBe(true)

    const row = await getJob(id)
    expect(row.splitStatus).toBe('error')
    expect(row.splitFailureCount).toBe(INGESTION_MAX_FAILURES)
    expect(row.splitDeadLetterAt).not.toBeNull()
  })

  test('orfao re-reivindicado NAO consome o orcamento de falhas (so entregas)', async () => {
    // Job entregue varias vezes por churn de infra (orfao), sem nunca falhar:
    // failureCount fica 0, entao o orcamento de retry real permanece intacto.
    await insertJob({
      splitStatus: 'processing',
      splitLeaseExpiresAt: new Date(Date.now() - 1000),
      splitLeaseToken: 'orfao',
      splitDeliveryCount: 7,
      splitFailureCount: 0,
    })

    const job = await claimNextIngestionJob()
    expect(job?.deliveryCount).toBe(8) // entregas sobem
    expect(job?.failureCount).toBe(0) // falhas intactas
  })

  test('deadLetterIngestion (backstop de entregas) poe em error e respeita o fencing', async () => {
    const id = await insertJob()
    const job = await claimNextIngestionJob()

    // Token errado: no-op + false.
    expect(await deadLetterIngestion(id, 'token-errado', 'x')).toBe(false)
    expect((await getJob(id)).splitStatus).toBe('processing')

    // Token certo: dead-letter terminal.
    expect(
      await deadLetterIngestion(id, job?.leaseToken ?? '', 'entregas demais'),
    ).toBe(true)
    const row = await getJob(id)
    expect(row.splitStatus).toBe('error')
    expect(row.splitDeadLetterAt).not.toBeNull()
  })

  test('renewIngestionLease so renova com o token correto', async () => {
    const id = await insertJob()
    const job = await claimNextIngestionJob()

    expect(await renewIngestionLease(id, job?.leaseToken ?? '')).toBe(true)
    expect(await renewIngestionLease(id, 'token-errado')).toBe(false)
  })
})
