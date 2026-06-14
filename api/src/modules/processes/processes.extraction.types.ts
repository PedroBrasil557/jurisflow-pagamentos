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

// Dados pessoais de uma PARTE (outorgante da procuracao, comprador/vendedor do
// contrato de compra e venda). Usado pela derivacao de ownerType/quitacao (v3).
export interface RawPerson {
  nome?: string
  cpf?: string
  rg?: string
  nascimento?: string // ISO yyyy-mm-dd
}

export interface RawCompraVenda {
  vendedores?: RawPerson[]
  compradores?: RawPerson[]
  dataAssinatura?: string // ISO yyyy-mm-dd
}

export interface RawExtraction {
  titular?: RawTitular
  endereco?: RawEndereco
  conjuge?: RawConjuge
  // Outorgantes da PROCURACAO = titular(es) do processo (ancora de QUEM).
  outorgantes?: RawPerson[]
  // Partes + data do CONTRATO DE COMPRA E VENDA particular.
  compraVenda?: RawCompraVenda
  camposNaoEncontrados?: string[]
  paginas?: RawPageClassification[]
}

// Saida crua do provider + metadados da chamada (modelo resolvido e uso de
// tokens) — necessarios para a auditoria de IA (ai_analysis), sem vazar bytes.
export interface RawExtractionResult {
  raw: RawExtraction
  model: string
  usage?: { inputTokens: number; outputTokens: number }
}

// Interface plugavel — permite trocar/empilhar provedores (Claude, etc.).
export interface DocumentExtractionProvider {
  readonly name: string
  extract(files: ExtractionInputFile[]): Promise<RawExtractionResult>
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

// Metadados da chamada de IA usados pela auditoria (ai_analysis kind
// document_extraction): modelo resolvido, uso de tokens e a classificacao crua
// de TODAS as paginas (pagina -> tipo) — a evidencia do que a IA decidiu.
export interface ExtractionMeta {
  model: string
  usage?: { inputTokens: number; outputTokens: number }
  paginas: RawPageClassification[]
  // Extracao por papel (v3) — alimenta os fatos da derivacao via auditoria.
  outorgantes?: RawPerson[]
  compraVenda?: RawCompraVenda
}

// Resultado normalizado + metadados da chamada, devolvido por
// extractDocumentsFromFiles para quem precisa auditar a classificacao.
export type ExtractionRunResult = ExtractionResult & { meta: ExtractionMeta }
