import { formatCpf, isValidCpf } from '../../shared/utils/cpf'
import {
  conditionalProcessDocumentTypes,
  defaultProcessDocumentTypes,
} from './processes.documents'
import type {
  ConfidenceLevel,
  ExtractedDocument,
  ExtractionField,
  ExtractionResult,
  RawExtraction,
} from './processes.extraction.types'

// Tipos de documento que podem ser desmembrados do PDF empacotado.
export const SPLITTABLE_DOCUMENT_KEYS = [
  'procuracao_advogado',
  'rg_cpf_cnh',
  'comprovante_endereco',
  'termo_entrega_recebimento_imovel',
  'declaracao_hipossuficiencia',
  'contrato_honorarios_advocaticios',
  'contrato_compra_venda',
  'rg_cpf_cnh_conjuge',
  'certidao_casamento',
  'certidao_obito',
] as const

const documentLabelByKey = new Map(
  [...defaultProcessDocumentTypes, ...conditionalProcessDocumentTypes].map(
    (type) => [type.key, type.label],
  ),
)

// Agrupa a classificacao por pagina em documentos (1 por tipo), na ordem dos
// tipos do checklist. Descarta 'outro' e tipos desconhecidos.
function buildDocuments(raw: RawExtraction): ExtractedDocument[] {
  const pagesByKey = new Map<string, Set<number>>()

  for (const entry of raw.paginas ?? []) {
    const key = entry.tipo
    const page = entry.pagina

    if (
      !SPLITTABLE_DOCUMENT_KEYS.includes(
        key as (typeof SPLITTABLE_DOCUMENT_KEYS)[number],
      )
    ) {
      continue
    }

    if (!Number.isInteger(page) || page < 1) {
      continue
    }

    const pages = pagesByKey.get(key) ?? new Set<number>()
    pages.add(page)
    pagesByKey.set(key, pages)
  }

  const documents: ExtractedDocument[] = []

  for (const key of SPLITTABLE_DOCUMENT_KEYS) {
    const pages = pagesByKey.get(key)

    if (!pages || pages.size === 0) {
      continue
    }

    documents.push({
      documentTypeKey: key,
      label: documentLabelByKey.get(key) ?? key,
      pages: Array.from(pages).sort((a, b) => a - b),
    })
  }

  return documents
}

const ID_SOURCE = 'RG/CNH'
const ADDRESS_SOURCE = 'Comprovante'

function confidenceLevel(value?: number): ConfidenceLevel {
  if (value == null) return 'media'
  if (value >= 0.85) return 'alta'
  if (value >= 0.6) return 'media'
  return 'baixa'
}

function upper(value?: string): string {
  return (value ?? '').trim().toUpperCase()
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function formatZip(value: string): { value: string; valid: boolean } {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 8) return { value: value.trim(), valid: false }
  return { value: `${digits.slice(0, 5)}-${digits.slice(5)}`, valid: true }
}

// Converte a saida crua do provider em campos validados para a tela de revisao.
export function normalizeExtraction(raw: RawExtraction): ExtractionResult {
  const fields: ExtractionField[] = []
  const warnings: string[] = []

  const titular = raw.titular ?? {}
  const idConfidence = confidenceLevel(titular.confianca)

  if (titular.fullName) {
    fields.push({
      key: 'fullName',
      label: 'Nome completo',
      value: upper(titular.fullName),
      confidence: idConfidence,
      valid: true,
      source: ID_SOURCE,
    })
  }

  if (titular.birthDate) {
    const validDate = isIsoDate(titular.birthDate)
    fields.push({
      key: 'birthDate',
      label: 'Data de nascimento',
      value: titular.birthDate,
      confidence: validDate ? idConfidence : 'baixa',
      valid: validDate,
      warning: validDate ? undefined : 'Data nao reconhecida — confira.',
      source: ID_SOURCE,
    })
  }

  if (titular.cpf) {
    const valid = isValidCpf(titular.cpf)
    fields.push({
      key: 'cpf',
      label: 'CPF',
      value: formatCpf(titular.cpf),
      confidence: valid ? idConfidence : 'baixa',
      valid,
      warning: valid ? undefined : 'CPF invalido (digito verificador).',
      source: ID_SOURCE,
    })
    if (!valid) {
      warnings.push('O CPF lido nao passou na validacao — confira manualmente.')
    }
  }

  if (titular.rg) {
    fields.push({
      key: 'rg',
      label: 'RG',
      value: upper(titular.rg),
      confidence: idConfidence,
      valid: true,
      source: ID_SOURCE,
    })
  }

  const endereco = raw.endereco
  if (endereco) {
    const addressConfidence = confidenceLevel(endereco.confianca)
    const addressFields: Array<[string, string, string]> = [
      ['street', 'Logradouro', upper(endereco.street)],
      ['number', 'Numero', upper(endereco.number)],
      ['complement', 'Complemento', upper(endereco.complement)],
      ['district', 'Bairro', upper(endereco.district)],
      ['city', 'Cidade', upper(endereco.city)],
      ['state', 'UF', upper(endereco.state)],
    ]

    for (const [key, label, value] of addressFields) {
      if (!value) continue
      fields.push({
        key,
        label,
        value,
        confidence: addressConfidence,
        valid: true,
        source: ADDRESS_SOURCE,
      })
    }

    if (endereco.zipcode) {
      const zip = formatZip(endereco.zipcode)
      fields.push({
        key: 'zipcode',
        label: 'CEP',
        value: zip.value,
        confidence: zip.valid ? addressConfidence : 'baixa',
        valid: zip.valid,
        warning: zip.valid
          ? undefined
          : 'CEP invalido (precisa ter 8 digitos).',
        source: ADDRESS_SOURCE,
      })
      if (!zip.valid) {
        warnings.push('O CEP lido nao tem 8 digitos — confira manualmente.')
      }
    }
  }

  if (raw.camposNaoEncontrados && raw.camposNaoEncontrados.length > 0) {
    warnings.push(
      `Campos nao lidos com seguranca: ${raw.camposNaoEncontrados.join(', ')}.`,
    )
  }

  return {
    fields,
    warnings,
    documents: buildDocuments(raw),
  }
}
