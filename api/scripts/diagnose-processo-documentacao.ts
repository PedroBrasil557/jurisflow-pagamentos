import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

// Diagnostico SOMENTE-LEITURA: por que um processo nao avancou para
// DOCUMENTACAO_PRONTA? Reconstroi os gates da derivacao (requiredPending,
// housingComplexLinked, reviewFlags, readiness) a partir do banco e imprime a
// ultima evidencia process_derivation (que registra a decisao real do motor).
//
// NAO escreve nada.
//
// Uso (a partir de api/):
//   DIAG_DATABASE_URL=postgresql://... bun run scripts/diagnose-processo-documentacao.ts --cpf 56476604520

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const cpfRaw = argValue('--cpf')
if (!cpfRaw) {
  console.error('Uso: bun run scripts/diagnose-processo-documentacao.ts --cpf <CPF>')
  process.exit(1)
}
const cpf = cpfRaw.replace(/\D/g, '')

const databaseUrl =
  process.env.DIAG_DATABASE_URL ?? process.env.TARGET_DATABASE_URL
if (!databaseUrl) {
  console.error('DIAG_DATABASE_URL (ou TARGET_DATABASE_URL) e obrigatoria.')
  process.exit(1)
}

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
})
const db = drizzle(pool)

function printRows(title: string, rows: Record<string, unknown>[]) {
  console.log(`\n=== ${title} ===`)
  if (rows.length === 0) {
    console.log('(sem linhas)')
    return
  }
  console.table(rows)
}

async function main() {
  // 1) Linha do processo — status atual + colunas que alimentam os gates.
  const proc = await db.execute(sql`
    SELECT id, code, full_name, status,
      housing_complex, housing_complex_id, housing_complex_source,
      owner_type, owner_type_source,
      caixa_analysis_status, procuracao_conjunto_status,
      caixa_quitacao_status,
      created_at, updated_at
    FROM process
    WHERE regexp_replace(cpf, '\\D', '', 'g') = ${cpf}
  `)
  printRows('1) Processo', proc.rows)
  const p = proc.rows[0] as { id?: string } | undefined
  if (!p?.id) {
    console.log('Processo nao encontrado por CPF.')
    return
  }
  const pid = p.id

  // 2) Checklist — tipos, obrigatoriedade cadastral, status do item e arquivo atual.
  const checklist = await db.execute(sql`
    SELECT pdt.key, pdt.is_required, pd.status AS doc_status,
      count(pdf.id) FILTER (WHERE pdf.is_current)::int AS arquivos_atuais,
      max(pdf.uploaded_at) AS ultimo_upload
    FROM process_document pd
    JOIN process_document_type pdt ON pdt.id = pd.document_type_id
    LEFT JOIN process_document_file pdf ON pdf.process_document_id = pd.id
    WHERE pd.process_id = ${pid}
    GROUP BY 1, 2, 3
    ORDER BY 1
  `)
  printRows('2) Checklist (anexos atuais por tipo)', checklist.rows)

  // 3) Arquivos em lote — split em voo segura a derivacao (readiness pending).
  const batch = await db.execute(sql`
    SELECT split_status, count(*)::int AS n
    FROM process_batch_file
    WHERE process_id = ${pid}
    GROUP BY 1
  `)
  printRows('3) Batch files (split_status)', batch.rows)

  // 4) Ultimas evidencias process_derivation — a decisao real do motor.
  const derivations = await db.execute(sql`
    SELECT created_at,
      decision->>'status' AS status_derivado,
      decision->>'readiness' AS readiness,
      decision->'reviewFlags' AS review_flags,
      decision->'ownerType' AS owner_type,
      output->'divergence' AS divergence
    FROM ai_analysis
    WHERE process_id = ${pid} AND kind = 'process_derivation'
    ORDER BY created_at DESC
    LIMIT 3
  `)
  console.log('\n=== 4) Ultimas derivacoes (process_derivation) ===')
  for (const r of derivations.rows) {
    console.log(JSON.stringify(r, null, 2))
  }
  if (derivations.rows.length === 0) {
    console.log('(nenhuma evidencia de derivacao — reconciliador nunca rodou para este processo)')
  }

  // 4b) requiredDocs da derivacao mais recente (o que o motor exige e por que).
  const reqDocs = await db.execute(sql`
    SELECT decision->'requiredDocs' AS required_docs,
      input->'facts' AS facts_snapshot
    FROM ai_analysis
    WHERE process_id = ${pid} AND kind = 'process_derivation'
    ORDER BY created_at DESC
    LIMIT 1
  `)
  console.log('\n=== 4b) requiredDocs + snapshot de fatos da ultima derivacao ===')
  for (const r of reqDocs.rows) {
    console.log(JSON.stringify(r, null, 2))
  }

  // 5) Extracoes de documento — o que a IA classificou/extraiu.
  const extractions = await db.execute(sql`
    SELECT created_at, status,
      output->'paginas' AS paginas,
      output->'compraVenda'->>'dataAssinatura' AS cv_data_assinatura,
      jsonb_array_length(coalesce(output->'termoCompradores', '[]'::jsonb)) AS termo_compradores_n,
      (output->>'procuracaoEndereco') IS NOT NULL AS tem_endereco_procuracao
    FROM ai_analysis
    WHERE process_id = ${pid} AND kind = 'document_extraction'
    ORDER BY created_at DESC
    LIMIT 5
  `)
  console.log('\n=== 5) Extracoes (document_extraction) ===')
  for (const r of extractions.rows) {
    console.log(JSON.stringify(r, null, 2))
  }

  // 6) Historico recente — transicoes e acoes automaticas.
  const history = await db.execute(sql`
    SELECT created_at, event_type, notes
    FROM process_history
    WHERE process_id = ${pid}
    ORDER BY created_at DESC
    LIMIT 15
  `)
  printRows('6) Historico recente', history.rows)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => pool.end())
