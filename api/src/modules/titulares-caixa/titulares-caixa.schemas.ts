import { z } from 'zod'
import {
  titularAverbacaoValues,
  titularQuitacaoStatuses,
} from './titulares-caixa.schema'

// Query param multi-valor: chega como string unica ou array na URL. Normaliza
// para array (ou undefined). O `.optional()` fica FORA do preprocess para o Hono
// inferir o campo como opcional no cliente RPC (mesmo padrao do listProcesses).
function toArray(value: unknown): unknown {
  return value === undefined
    ? undefined
    : Array.isArray(value)
      ? value
      : [value]
}

export const listTitularesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  page: z.coerce.number().int().positive().default(1),
  // Busca por nome ou CPF.
  search: z.string().trim().optional(),
  // Filtros por coluna.
  uf: z.preprocess(toArray, z.array(z.string())).optional(),
  municipio: z.string().trim().optional(),
  modalidade: z.preprocess(toArray, z.array(z.string())).optional(),
  empreendimento: z.preprocess(toArray, z.array(z.string())).optional(),
  // Filtro por conjunto (housing_complex.id).
  conjuntoIds: z.preprocess(toArray, z.array(z.string())).optional(),
  logradouros: z.preprocess(toArray, z.array(z.string())).optional(),
  quitacaoStatuses: z
    .preprocess(toArray, z.array(z.enum(titularQuitacaoStatuses)))
    .optional(),
  averbacoes: z
    .preprocess(toArray, z.array(z.enum(titularAverbacaoValues)))
    .optional(),
  assinaturaFrom: z.string().trim().optional(),
  assinaturaTo: z.string().trim().optional(),
})

export type ListTitularesQuery = z.infer<typeof listTitularesQuerySchema>

// Mesmos filtros da listagem, sem paginacao — usado no export Excel.
export const exportTitularesQuerySchema = z.object({
  search: z.string().trim().optional(),
  uf: z.preprocess(toArray, z.array(z.string())).optional(),
  municipio: z.string().trim().optional(),
  modalidade: z.preprocess(toArray, z.array(z.string())).optional(),
  empreendimento: z.preprocess(toArray, z.array(z.string())).optional(),
  // Filtro por conjunto (housing_complex.id).
  conjuntoIds: z.preprocess(toArray, z.array(z.string())).optional(),
  logradouros: z.preprocess(toArray, z.array(z.string())).optional(),
  quitacaoStatuses: z
    .preprocess(toArray, z.array(z.enum(titularQuitacaoStatuses)))
    .optional(),
  averbacoes: z
    .preprocess(toArray, z.array(z.enum(titularAverbacaoValues)))
    .optional(),
  assinaturaFrom: z.string().trim().optional(),
  assinaturaTo: z.string().trim().optional(),
})

export type ExportTitularesQuery = z.infer<typeof exportTitularesQuerySchema>

export const reconsultarPayloadSchema = z.object({
  // Vazio ou ausente = reconsultar TODOS os filtrados? Nao — exige ids explicitos
  // para evitar reenfileirar 13k por engano. Max por lote.
  ids: z.array(z.string().min(1)).min(1).max(1000),
})

export const titularIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const titularDocumentoParamsSchema = z.object({
  id: z.string().min(1),
  docId: z.string().min(1),
})
