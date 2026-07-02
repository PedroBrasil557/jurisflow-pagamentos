import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import { user } from '../auth/auth.schema'
import { process as processTable } from '../processes/processes.schema'
import {
  claimNextQuitacaoJob,
  recordQuitacaoResult,
} from './caixa-quitacao.service'

// Testes de INTEGRACAO do fencing por claim_token da fila de quitacao (processos).
// Exigem Postgres real (claim com FOR UPDATE SKIP LOCKED + re-claim por staleness).
// Rodam SO com RUN_INTEGRATION=1 (DATABASE_URL num banco isolado sem worker), via
// `bun run test:integration`. Sem a flag, o suite e pulado.
const RUN = process.env.RUN_INTEGRATION === '1'
const suite = RUN ? describe : describe.skip

suite(
  'quitacao (processos): fencing por claim_token (integracao Postgres)',
  () => {
    const userId = `test-user-${crypto.randomUUID()}`
    const processId = `test-proc-${crypto.randomUUID()}`
    const CPF = '11144477735'

    beforeEach(async () => {
      // Reidrata o processo para o estado inicial elegivel a claim, isolando cada teste.
      await db.delete(processTable).where(eq(processTable.id, processId))
      await db.delete(user).where(eq(user.id, userId))
      await db.insert(user).values({
        id: userId,
        name: 'Teste Fencing',
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
        caixaQuitacaoStatus: 'pending',
        quitacaoConsultas: [{ cpf: CPF, status: 'pending' }],
      })
    })

    afterAll(async () => {
      await db.delete(processTable).where(eq(processTable.id, processId))
      await db.delete(user).where(eq(user.id, userId))
      await (
        globalThis as typeof globalThis & {
          __apiPool?: { end: () => Promise<void> }
        }
      ).__apiPool?.end()
    })

    async function getProc() {
      const [row] = await db
        .select()
        .from(processTable)
        .where(eq(processTable.id, processId))
        .limit(1)
      return row
    }

    // Reproduz o re-claim por staleness: envelhece o heartbeat do claim vigente para
    // alem do STALE_MINUTES, tornando o processo 'processing' orfao re-reivindicavel.
    async function makeStale() {
      await db
        .update(processTable)
        .set({ caixaQuitacaoStartedAt: new Date(Date.now() - 20 * 60_000) })
        .where(eq(processTable.id, processId))
    }

    test('claim grava um claim_token e o expoe no job', async () => {
      const job = await claimNextQuitacaoJob()
      expect(job?.processId).toBe(processId)
      expect(job?.cpfs).toEqual([CPF])
      expect(job?.claimToken).toBeTruthy()

      const row = await getProc()
      expect(row.caixaQuitacaoStatus).toBe('processing')
      expect(row.caixaQuitacaoClaimToken).toBe(job?.claimToken ?? '')
    })

    test('/result com token errado e rejeitado com 409 e nao muda o estado', async () => {
      const job = await claimNextQuitacaoJob()
      if (!job) throw new Error('claim deveria ter reivindicado o processo')

      let status = 0
      try {
        await recordQuitacaoResult({
          processId,
          claimToken: 'token-errado',
          consultas: [{ cpf: CPF, result: 'nao_encontrado' }],
        })
      } catch (error) {
        status = error instanceof ServiceError ? error.statusCode : -1
      }
      expect(status).toBe(409)

      // Estado vivo intacto: continua 'processing' com o token do claim vigente.
      const row = await getProc()
      expect(row.caixaQuitacaoStatus).toBe('processing')
      expect(row.caixaQuitacaoClaimToken).toBe(job.claimToken)
    })

    test('double-dispatch: /result do claim OBSOLETO nao sobrescreve o claim vivo', async () => {
      // Claim A comeca a processar.
      const jobA = await claimNextQuitacaoJob()
      if (!jobA) throw new Error('claim A falhou')

      // A trava (lento) > STALE_MINUTES e o processo e re-reivindicado por B.
      await makeStale()
      const jobB = await claimNextQuitacaoJob()
      if (!jobB) throw new Error('re-claim B falhou')
      expect(jobB.claimToken).not.toBe(jobA.claimToken)

      // A (obsoleto) finalmente reporta enquanto B ainda esta 'processing'. Sem o
      // fencing, isso sobrescreveria o estado vivo de B; com ele, 409 e no-op.
      let status = 0
      try {
        await recordQuitacaoResult({
          processId,
          claimToken: jobA.claimToken,
          consultas: [{ cpf: CPF, result: 'nao_encontrado' }],
        })
      } catch (error) {
        status = error instanceof ServiceError ? error.statusCode : -1
      }
      expect(status).toBe(409)

      // B (vigente) reporta e VENCE: aplica o desfecho.
      const res = await recordQuitacaoResult({
        processId,
        claimToken: jobB.claimToken,
        consultas: [{ cpf: CPF, result: 'nao_encontrado' }],
      })
      expect(res.status).toBe('nao_encontrado')

      const row = await getProc()
      expect(row.caixaQuitacaoStatus).toBe('nao_encontrado')
    })
  },
)
