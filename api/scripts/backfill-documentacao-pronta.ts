import { and, eq, sql } from 'drizzle-orm'
import { closeDb, db } from '../src/shared/db'
import { deriveProcessState } from '../src/modules/processes/derive/derive'
import { gatherFacts } from '../src/modules/processes/derive/facts.gather'
import { reconcileProcessStatus } from '../src/modules/processes/processes.checklist.service'
import { process as processTable } from '../src/modules/processes/processes.schema'

// Backfill: destrava os processos EM_DOCUMENTACAO cuja documentacao ja esta
// COMPLETA mas que ficaram presos no antigo readiness pending eterno (ver
// facts.gather.ts). So mexe no STATUS (e no historico); NAO toca ownerType,
// conjunto ou quitacao.
//
// PRECISA rodar a partir deste checkout (que tem a correcao): o --apply chama
// reconcileProcessStatus, o MESMO motor da aplicacao — ele e o juiz. Idempotente:
// so grava quando o status muda; rodar duas vezes nao causa dano.
//
// DRY-RUN por padrao: PREVE quais flipam usando a regra REAL do reconcile
// (checklist COMPLETO — inclui declaracao_quitacao e os docs da Caixa — + gates de
// derivacao readiness/reviewFlags). NAO usa deriveProcessState.status cru (esse olha
// uma lista de docs mais curta e conta indevido).
//
// Uso (a partir de api/), com DATABASE_URL de PROD (o mesmo do promote-titulares) e
// ENVIRONMENT setado para ligar o TLS do RDS:
//
//   DATABASE_URL=postgresql://...jurisflow ENVIRONMENT=prod \
//     bun run scripts/backfill-documentacao-pronta.ts                  # dry-run
//   DATABASE_URL=... ENVIRONMENT=prod \
//     bun run scripts/backfill-documentacao-pronta.ts --apply          # grava
//
// Filtros opcionais:
//   --municipio JUAZEIRO   limita a uma cidade (process.city, case-insensitive)
//   --cpf 56476604520      um unico processo (para testar)
//   --limit 10             processa no maximo N processos (primeira rodada cautelosa)

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i === -1 ? null : (process.argv[i + 1] ?? null)
}

const apply = process.argv.includes('--apply')
const municipio = argValue('--municipio')
const cpf = argValue('--cpf')?.replace(/\D/g, '') || null
const limit = Number(argValue('--limit')) || Number.POSITIVE_INFINITY

// Conjunto "checklist completo" (regra do app aproximada em SQL: TODOS os is_required
// — base + termo + declaracao_quitacao + docs de conjunto —, com os condicionais
// ativados pelas mesmas colunas que getConditionalDocumentKeys usa).
async function loadChecklistCompleteSet(): Promise<Set<string>> {
  const rows = (
    await db.execute(sql`
      WITH req AS (
        SELECT p.id AS process_id,
          CASE
            WHEN pdt.key IN ('solicitacao_caixa','requerimento_adm_caixa','matricula_imovel')
              THEN EXISTS (SELECT 1 FROM housing_complex_file h
                WHERE h.housing_complex_id = p.housing_complex_id
                  AND h.document_type_key = pdt.key AND h.is_current)
            WHEN pd.status = 'OK_SEM_ARQUIVO' THEN true
            ELSE EXISTS (SELECT 1 FROM process_document_file f
              WHERE f.process_document_id = pd.id AND f.is_current)
          END AS presente
        FROM process p
        JOIN process_document pd ON pd.process_id = p.id
        JOIN process_document_type pdt ON pdt.id = pd.document_type_id
        WHERE p.status = 'EM_DOCUMENTACAO'
          AND p.housing_complex_id IS NOT NULL
          AND pdt.is_required
          AND NOT (pdt.key = 'rg_cpf_cnh_conjuge' AND coalesce(p.spouse_contract_signed,'') <> 'sim')
          AND NOT (pdt.key = 'contrato_compra_venda' AND p.owner_type <> 'nao_titular_contrato_caixa')
      )
      SELECT process_id FROM req GROUP BY 1 HAVING bool_and(presente)
    `)
  ).rows as Array<{ process_id: string }>
  return new Set(rows.map((r) => r.process_id))
}

async function main() {
  const conditions = [eq(processTable.status, 'EM_DOCUMENTACAO')]
  if (municipio) {
    conditions.push(sql`lower(${processTable.city}) = lower(${municipio})`)
  }
  if (cpf) {
    conditions.push(
      sql`regexp_replace(${processTable.cpf}, '\\D', '', 'g') = ${cpf}`,
    )
  }

  const scope = await db
    .select({
      id: processTable.id,
      code: processTable.code,
      fullName: processTable.fullName,
      city: processTable.city,
    })
    .from(processTable)
    .where(and(...conditions))

  const scoped = Number.isFinite(limit) ? scope.slice(0, limit) : scope
  console.log(
    `EM_DOCUMENTACAO no escopo: ${scope.length}` +
      (Number.isFinite(limit) ? ` (limitado a ${scoped.length})` : '') +
      (municipio ? ` | municipio=${municipio}` : '') +
      (cpf ? ` | cpf=${cpf}` : ''),
  )

  const complete = await loadChecklistCompleteSet()

  // Previsao pela regra REAL: checklist completo + readiness ready + sem reviewFlag.
  const willFlip: typeof scoped = []
  for (const p of scoped) {
    if (!complete.has(p.id)) continue
    const facts = await gatherFacts(p.id)
    if (!facts) continue
    const d = deriveProcessState(facts)
    if (d.readiness === 'ready' && d.reviewFlags.length === 0) {
      willFlip.push(p)
    }
  }

  console.log(`\nFliparao para DOCUMENTACAO_PRONTA (previsao): ${willFlip.length}`)
  for (const p of willFlip) console.log(`  ${p.code}  ${p.fullName}  (${p.city})`)

  if (!apply) {
    console.log(
      '\nDRY-RUN — nada foi gravado. Rode de novo com --apply para efetivar.',
    )
    return
  }

  // --apply: reconcilia TODO o escopo (o banco e o juiz — nao confio so na previsao
  // SQL). reconcileProcessStatus so grava quando o status muda.
  console.log(`\n--apply: reconciliando ${scoped.length} processo(s)...`)
  let flipped = 0
  let unchanged = 0
  const failures: Array<{ code: string; error: string }> = []
  for (const p of scoped) {
    try {
      const updated = await reconcileProcessStatus(p.id, { id: 'jurisflow-bot' })
      if (updated.status === 'DOCUMENTACAO_PRONTA') flipped++
      else unchanged++
    } catch (error) {
      failures.push({ code: p.code, error: String(error) })
      console.error(`  [erro] ${p.code}: ${String(error)}`)
    }
  }

  console.log(
    `\nConcluido: ${flipped} -> DOCUMENTACAO_PRONTA, ${unchanged} sem mudanca, ${failures.length} erro(s).`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(closeDb)
