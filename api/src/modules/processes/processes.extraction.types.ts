// Tipos compartilhados do modulo de extracao de documentos (RG/CNH + comprovante).
// Portado do app Electron de referencia, adaptado para o backend Hono.

export type ExtractionFileKind = 'pdf' | 'image'

export type ExtractionMediaType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'

export interface ExtractionInputFile {
  base64: string
  kind: ExtractionFileKind
  mediaType: ExtractionMediaType
}

// Saida crua do provider (espelha o schema da ferramenta enviada ao modelo).
export interface RawTitular {
  fullName?: string
  birthDate?: string
  cpf?: string
  rg?: string
  filiacaoPai?: string
  filiacaoMae?: string
  naturalidade?: string
  orgaoExpedidor?: string
  dataExpedicao?: string
  confianca?: number
}

export interface RawEndereco {
  street?: string
  number?: string
  complement?: string
  district?: string
  city?: string
  state?: string
  zipcode?: string
  origem?: string
  confianca?: number
}

export interface RawExtraction {
  documentosDetectados?: string[]
  titular?: RawTitular
  endereco?: RawEndereco
  camposNaoEncontrados?: string[]
}

// Interface plugavel — permite trocar/empilhar provedores (Claude, etc.).
export interface DocumentExtractionProvider {
  readonly name: string
  extract(files: ExtractionInputFile[]): Promise<RawExtraction>
}

// Resultado normalizado e validado, pronto para a tela de revisao.
export type ConfidenceLevel = 'alta' | 'media' | 'baixa'

export interface ExtractionField {
  /** nome do campo no formulario (ex.: fullName, cpf, street) */
  key: string
  label: string
  value: string
  confidence: ConfidenceLevel
  valid: boolean
  warning?: string
  /** origem do dado (ex.: "RG/CNH", "Comprovante") */
  source: string
}

export interface ExtractionResult {
  documentsDetected: string[]
  fields: ExtractionField[]
  warnings: string[]
}
