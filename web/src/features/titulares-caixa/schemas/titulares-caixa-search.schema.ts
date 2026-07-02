import {
  type TitularAverbacao,
  type TitularQuitacaoStatus,
  titularAverbacaoLabels,
  titularQuitacaoStatusLabels,
} from '../services/titulares-caixa.service'

export type TitularesSearch = {
  page?: number
  search?: string
  uf?: string[]
  municipio?: string
  modalidade?: string[]
  empreendimento?: string[]
  logradouros?: string[]
  quitacaoStatuses?: TitularQuitacaoStatus[]
  averbacoes?: TitularAverbacao[]
  assinaturaFrom?: string
  assinaturaTo?: string
}

function parsePage(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed >= 1) return parsed
  }
  return undefined
}

function parseText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseStringArray(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : value != null ? [value] : []
  const valid = raw.filter(
    (item): item is string => typeof item === 'string' && item.trim() !== '',
  )
  return valid.length > 0 ? valid : undefined
}

function parseQuitacaoStatuses(
  value: unknown,
): TitularQuitacaoStatus[] | undefined {
  const raw = Array.isArray(value) ? value : value != null ? [value] : []
  const valid = raw.filter(
    (item): item is TitularQuitacaoStatus =>
      typeof item === 'string' && item in titularQuitacaoStatusLabels,
  )
  return valid.length > 0 ? valid : undefined
}

function parseAverbacoes(value: unknown): TitularAverbacao[] | undefined {
  const raw = Array.isArray(value) ? value : value != null ? [value] : []
  const valid = raw.filter(
    (item): item is TitularAverbacao =>
      typeof item === 'string' && item in titularAverbacaoLabels,
  )
  return valid.length > 0 ? valid : undefined
}

function parseIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined
  }
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? undefined : value
}

export function parseTitularesSearch(
  search: Record<string, unknown>,
): TitularesSearch {
  const page = parsePage(search.page)
  const term = parseText(search.search)
  const uf = parseStringArray(search.uf)
  const municipio = parseText(search.municipio)
  const modalidade = parseStringArray(search.modalidade)
  const empreendimento = parseStringArray(search.empreendimento)
  const logradouros = parseStringArray(search.logradouros)
  const quitacaoStatuses = parseQuitacaoStatuses(search.quitacaoStatuses)
  const averbacoes = parseAverbacoes(search.averbacoes)
  const assinaturaFrom = parseIsoDate(search.assinaturaFrom)
  const assinaturaTo = parseIsoDate(search.assinaturaTo)

  return {
    ...(page ? { page } : {}),
    ...(term ? { search: term } : {}),
    ...(uf ? { uf } : {}),
    ...(municipio ? { municipio } : {}),
    ...(modalidade ? { modalidade } : {}),
    ...(empreendimento ? { empreendimento } : {}),
    ...(logradouros ? { logradouros } : {}),
    ...(quitacaoStatuses ? { quitacaoStatuses } : {}),
    ...(averbacoes ? { averbacoes } : {}),
    ...(assinaturaFrom ? { assinaturaFrom } : {}),
    ...(assinaturaTo ? { assinaturaTo } : {}),
  }
}
