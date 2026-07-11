import { inArray, type SQL, sql } from 'drizzle-orm'
import type { ResolvedPermissions } from '../permissions/permissions.types'
import { titularContratoCaixa } from './titulares-caixa.schema'

// Recorte de visibilidade dos titulares por CONJUNTO (housing_complex). Inspirado em
// buildProcessVisibilityFilter dos processos, mas uma SIMPLIFICACAO de 2 ramos (sem o
// ramo de criador-ou-responsavel — ver nota abaixo). Regra do produto: "para
// visualizar as informacoes de titular Caixa o usuario precisa ter permissao ao
// conjunto".
//
// - admin/master ou escopo 'all': ve tudo (sem filtro).
// - demais escopos (housing_complex/own): so titulares dos conjuntos liberados
//   (allowedHousingComplexIds = uniao dos grants de perfil + grants diretos).
//   Sem nenhum conjunto liberado -> nada (sql`false`).
//
// NAO ha fallback por "criador" (diferente de processo): titular nao tem dono de
// negocio, o acesso e puramente por conjunto. Titular com housingComplexId NULL
// (empreendimento sem conjunto cadastrado) so aparece para admin/all-scope.
export function buildTitularesVisibilityFilter(
  perms: ResolvedPermissions,
): SQL | undefined {
  if (perms.isAdmin || perms.processScope === 'all') {
    return undefined
  }

  const allowedIds = perms.allowedHousingComplexIds
  return allowedIds.length > 0
    ? inArray(titularContratoCaixa.housingComplexId, allowedIds)
    : sql`false`
}
