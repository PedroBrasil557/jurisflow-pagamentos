import { formatCpf, isValidCpf } from '../../shared/utils/cpf'
import type {
  ConfidenceLevel,
  ExtractionField,
  ExtractionResult,
  RawExtraction,
} from './processes.extraction.types'

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

function formatZip(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  if (digits.length !== 8) return value
  return `${digits.slice(0, 5)}-${digits.slice(5)}`
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
      ['zipcode', 'CEP', endereco.zipcode ? formatZip(endereco.zipcode) : ''],
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
  }

  if (raw.camposNaoEncontrados && raw.camposNaoEncontrados.length > 0) {
    warnings.push(
      `Campos nao lidos com seguranca: ${raw.camposNaoEncontrados.join(', ')}.`,
    )
  }

  return {
    documentsDetected: raw.documentosDetectados ?? [],
    fields,
    warnings,
  }
}
