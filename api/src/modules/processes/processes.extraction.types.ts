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

// Conjuge extraido do TERMO DE ENTREGA/RECEBIMENTO (Caixa): presente apenas quando o
// termo indica que o contrato foi assinado tambem pelo conjuge. Sua presenca marca
// spouseContractSigned='sim' (condiciona o doc rg_cpf_cnh_conjuge).
export interface RawConjuge {
  fullName?: string
  cpf?: string
  birthDate?: string
  confianca?: number
}

export interface RawPageClassification {
  pagina: number
  tipo: string
}

export interface RawExtraction {
  titular?: RawTitular
  endereco?: RawEndereco
  conjuge?: RawConjuge
  camposNaoEncontrados?: string[]
  paginas?: RawPageClassification[]
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

// Plano de desmembramento: paginas do PDF agrupadas por tipo de documento
// (key do checklist). Usado para dividir o PDF e anexar cada parte.
export interface ExtractedDocument {
  documentTypeKey: string
  label: string
  pages: number[]
}

export interface ExtractionResult {
  fields: ExtractionField[]
  warnings: string[]
  documents: ExtractedDocument[]
}
