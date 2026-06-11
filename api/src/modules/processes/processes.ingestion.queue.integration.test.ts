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
  failIngestion,
  INGESTION_MAX_ATTEMPTS,
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

  test('claim reivindica um job queued, incrementa attempts e grava lease+token', async () => {
    const id = await insertJob()

    const job = await claimNextIngestionJob()

    expect(job?.batchFileId).toBe(id)
    expect(job?.attempts).toBe(1)
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
      splitAttempts: 1,
    })

    const job = await claimNextIngestionJob()

    expect(job?.batchFileId).toBe(id)
    expect(job?.attempts).toBe(2)
    expect(job?.leaseToken).not.toBe('token-antigo')
  })

  test('claim NAO reivindica processing com lease VIVO', async () => {
    await insertJob({
      splitStatus: 'processing',
      splitLeaseExpiresAt: new Date(Date.now() + 60_000),
      splitLeaseToken: 'token-vivo',
      splitAttempts: 1,
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

    // Token errado: no-op (continua processing)
    await markIngestionDone(id, 'token-errado', 'nao deveria valer')
    expect((await getJob(id)).splitStatus).toBe('processing')

    // Token certo: conclui
    await markIngestionDone(id, job?.leaseToken ?? '', 'ok')
    const row = await getJob(id)
    expect(row.splitStatus).toBe('done')
    expect(row.splitLeaseToken).toBeNull()
  })

  test('failIngestion com tentativas restantes volta para queued com backoff', async () => {
    const id = await insertJob()
    const job = await claimNextIngestionJob() // attempts = 1

    await failIngestion(
      id,
      job?.leaseToken ?? '',
      job?.attempts ?? 1,
      'transitorio',
    )

    const row = await getJob(id)
    expect(row.splitStatus).toBe('queued')
    expect(row.splitLeaseExpiresAt).not.toBeNull() // backoff (elegivel-a-partir-de)
    expect(row.splitDeadLetterAt).toBeNull()
  })

  test('failIngestion com tentativas esgotadas vai para dead-letter (error)', async () => {
    const id = await insertJob()
    const job = await claimNextIngestionJob()

    await failIngestion(
      id,
      job?.leaseToken ?? '',
      INGESTION_MAX_ATTEMPTS,
      'veneno',
    )

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
