import { and, eq, inArray, or, type SQL, sql } from 'drizzle-orm'
import type { ResolvedPermissions } from '../permissions/permissions.types'
import { titularContratoCaixa } from './titulares-caixa.schema'

// Recorte de visibilidade dos titulares — UNIAO (OR) de tres dimensoes de grant:
// CONJUNTO (housing_complex), UF (estado) e MUNICIPIO (cidade). Regra do produto:
// "para visualizar titular Caixa o usuario precisa ter permissao ao conjunto,
// estado ou cidade".
//
// - admin/master ou escopo 'all': ve tudo (sem filtro).
// - demais: ve titular que casa QUALQUER dimensao liberada (conjunto liberado OU UF
//   liberada OU municipio liberado). Sem NENHUMA dimensao liberada -> nada (`false`).
//
// NAO ha fallback por "criador" (diferente de processo): titular nao tem dono de
// negocio. IMPORTANTE: nao curto-circuitar em `false` so porque os conjuntos estao
// vazios — o `false` so vale quando as TRES dimensoes estao vazias, senao os grants
// de UF/municipio seriam ignorados.
export function buildTitularesVisibilityFilter(
  perms: ResolvedPermissions,
): SQL | undefined {
  if (perms.isAdmin || perms.processScope === 'all') {
    return undefined
  }

  const clauses: SQL[] = []
  if (perms.allowedHousingComplexIds.length > 0) {
    clauses.push(
      inArray(
        titularContratoCaixa.housingComplexId,
        perms.allowedHousingComplexIds,
      ),
    )
  }
  if (perms.allowedUfs.length > 0) {
    clauses.push(inArray(titularContratoCaixa.uf, perms.allowedUfs))
  }
  if (perms.allowedMunicipios.length > 0) {
    const municipioClauses = perms.allowedMunicipios.map((m) =>
      and(
        eq(titularContratoCaixa.uf, m.uf),
        eq(titularContratoCaixa.municipio, m.municipio),
      ),
    )
    const municipioOr = or(...municipioClauses)
    if (municipioOr) {
      clauses.push(municipioOr)
    }
  }

  if (clauses.length === 0) {
    return sql`false`
  }
  // `or` com 1+ clausulas retorna SQL; o fallback nunca ocorre (clauses nao vazio).
  return or(...clauses) ?? sql`false`
}
