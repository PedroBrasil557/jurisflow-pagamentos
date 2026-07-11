import { Pool } from 'pg'

// Diagnostico SOMENTE-LEITURA: lista os `empreendimento` de titulares Caixa que
// ainda NAO tem conjunto (housing_complex) vinculado — ou seja, os conjuntos que
// o admin precisa cadastrar (Cadastros > Conjuntos) para liberar a visibilidade
// por conjunto. O vinculo e resolvido por nome normalizado (upper(trim())), o
// mesmo match do backfill (migracao 0033) e do import; entao "sem conjunto" =
// "nenhum housing_complex com nome batendo o empreendimento".
//
// Enquanto um empreendimento estiver aqui, seus titulares so aparecem para
// admin/all-scope. Depois de cadastrar o conjunto com nome igual e reimportar a
// planilha (o import re-resolve o vinculo), eles passam a respeitar a permissao
// por conjunto.
//
// Uso (a partir de api/):
//   bun run scripts/diagnose-titular-conjuntos.ts
//   DATABASE_URL=postgresql://... bun run scripts/diagnose-titular-conjuntos.ts

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:3557/app'

const isProduction =
  process.env.ENVIRONMENT === 'prod' || process.env.ENVIRONMENT === 'dev'

const pool = new Pool({
  connectionString: databaseUrl,
  ...(isProduction ? { ssl: { rejectUnauthorized: false } } : {}),
})

try {
  const [{ rows: totals }, { rows: unmatched }] = await Promise.all([
    pool.query<{
      titulares: string
      com_conjunto: string
      sem_conjunto: string
      conjuntos: string
    }>(
      `SELECT
         count(*) AS titulares,
         count(*) FILTER (WHERE housing_complex_id IS NOT NULL) AS com_conjunto,
         count(*) FILTER (WHERE housing_complex_id IS NULL) AS sem_conjunto,
         (SELECT count(*) FROM housing_complex) AS conjuntos
       FROM titular_contrato_caixa`,
    ),
    pool.query<{
      empreendimento: string
      locais: string
      titulares: string
    }>(
      `SELECT
         empreendimento,
         string_agg(DISTINCT municipio || '/' || uf, ', ' ORDER BY municipio || '/' || uf) AS locais,
         count(*) AS titulares
       FROM titular_contrato_caixa
       WHERE housing_complex_id IS NULL
       GROUP BY empreendimento
       ORDER BY count(*) DESC, empreendimento`,
    ),
  ])

  const t = totals[0]
  console.log('\n=== Titular Caixa: cobertura de conjunto ===')
  console.log(`Titulares .............. ${t?.titulares ?? 0}`)
  console.log(`  com conjunto ......... ${t?.com_conjunto ?? 0}`)
  console.log(`  SEM conjunto ......... ${t?.sem_conjunto ?? 0}  (visiveis so p/ admin)`)
  console.log(`Conjuntos cadastrados .. ${t?.conjuntos ?? 0}`)

  if (unmatched.length === 0) {
    console.log('\nTodos os empreendimentos tem conjunto vinculado. Nada a cadastrar.')
  } else {
    console.log(
      `\n=== ${unmatched.length} empreendimento(s) SEM conjunto — cadastrar com este nome exato ===`,
    )
    console.log('titulares  empreendimento  ->  locais')
    console.log('---------  --------------------------')
    for (const row of unmatched) {
      const count = String(row.titulares).padStart(8)
      console.log(`${count}  ${row.empreendimento}  ->  ${row.locais}`)
    }
    console.log(
      '\nDica: o nome do conjunto (housing_complex.name) deve bater o empreendimento por',
    )
    console.log(
      'upper(trim(...)). Apos cadastrar, reimporte a planilha (o import re-resolve o',
    )
    console.log(
      'vinculo no onConflictDoUpdate) para os titulares existentes ligarem ao conjunto.',
    )
  }
} finally {
  await pool.end()
}
