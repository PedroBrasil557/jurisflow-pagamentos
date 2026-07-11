// Parametros ajustaveis da deteccao/recorte de borda, tratados como DADO
// versionado (nao valores hardcoded). Um preset nomeado mapeia uma versao para
// um conjunto de valores; o harness offline (scanner-bench) e o runtime (o
// WebScannerDialog) leem os MESMOS presets. Assim da para:
//   - varrer configs offline e medir qual recorta melhor (IoU/cobertura), e
//   - trocar/voltar a versao em producao mudando so o setting (sem redeploy).
// A versao ativa em prod vem do banco (appSettings.scannerTuningVersion); se nao
// houver, usa DEFAULT_TUNING_VERSION.

// Como o quad detectado e tratado quando a deteccao FALHA (nenhum canto
// confiavel): 'full-frame' usa o quadro inteiro (nao descarta nada, so pode
// sobrar fundo — recuperavel); 'inset-8' e o comportamento legado (recuo 8% em
// todos os lados, que corta a faixa externa).
export type ScannerFallbackMode = 'full-frame' | 'inset-8'

// Variante do modelo DocAligner. Informativo no runtime (o model.onnx servido e
// o que vale de fato); o harness usa para escolher qual arquivo carregar.
export type ScannerModelVariant = 'lcnet100' | 'fastvit_sa24'

export type ScannerRiskReview = {
  // Abrir o passo de ajuste de cantos antes de gravar quando a deteccao for
  // arriscada. Converte perda silenciosa em correcao visivel.
  enabled: boolean
  // Sempre revisar (nao so quando arriscado). +1 toque por pagina.
  always: boolean
  // Canto a menos desta fracao da borda -> arriscado (documento provavelmente
  // sangra alem do quadro e foi cortado).
  edgeMarginPct: number
  // Area do quad abaixo desta fracao do frame -> arriscado (mis-deteccao).
  minAreaRatio: number
}

export type ScannerTuning = {
  // Margem de folga (outset) aplicada ao quad DETECTADO, fracao ~[0..0.1]. As
  // assinaturas moram nos ~8-10% externos; a folga garante que uma deteccao
  // levemente para dentro ainda as inclua, ao custo de uma tira fina de fundo.
  marginRatio: number
  fallbackMode: ScannerFallbackMode
  modelVariant: ScannerModelVariant
  // Preprocess: preservar aspecto (letterbox) em vez do squish 256x256.
  // Experimento — o modelo foi treinado com stretch, entao pode piorar; so
  // liga se o A/B do harness mostrar ganho.
  letterbox: boolean
  riskReview: ScannerRiskReview
}

// Reproduz o comportamento anterior a esta feature (linha de base do A/B).
const V1_BASELINE: ScannerTuning = {
  marginRatio: 0,
  fallbackMode: 'inset-8',
  modelVariant: 'lcnet100',
  letterbox: false,
  riskReview: {
    enabled: false,
    always: false,
    edgeMarginPct: 0.02,
    minAreaRatio: 0.35,
  },
}

// Correcao recomendada: folga de 3%, fallback full-frame e revisao quando
// arriscado. Mantem o modelo/letterbox atuais.
const V2_MARGIN3_FULLFRAME: ScannerTuning = {
  marginRatio: 0.03,
  fallbackMode: 'full-frame',
  modelVariant: 'lcnet100',
  letterbox: false,
  riskReview: {
    enabled: true,
    always: false,
    edgeMarginPct: 0.02,
    minAreaRatio: 0.35,
  },
}

// Experimento: v2 + modelo mais preciso/pesado.
const V3_FASTVIT: ScannerTuning = {
  ...V2_MARGIN3_FULLFRAME,
  modelVariant: 'fastvit_sa24',
}

// Experimento: v2 + letterbox no preprocess.
const V4_LETTERBOX: ScannerTuning = {
  ...V2_MARGIN3_FULLFRAME,
  letterbox: true,
}

export const SCANNER_TUNING_PRESETS = {
  'v1-baseline': V1_BASELINE,
  'v2-margin3-fullframe': V2_MARGIN3_FULLFRAME,
  'v3-fastvit': V3_FASTVIT,
  'v4-letterbox': V4_LETTERBOX,
} as const

export type ScannerTuningVersion = keyof typeof SCANNER_TUNING_PRESETS

export const DEFAULT_TUNING_VERSION: ScannerTuningVersion =
  'v2-margin3-fullframe'

export const DEFAULT_TUNING: ScannerTuning =
  SCANNER_TUNING_PRESETS[DEFAULT_TUNING_VERSION]

// Resolve uma versao (possivelmente vinda do banco, desconhecida) para o tuning.
// Versao invalida/ausente cai no default — nunca quebra o scanner.
export function resolveTuning(version: string | null | undefined): {
  version: ScannerTuningVersion
  tuning: ScannerTuning
} {
  if (version && version in SCANNER_TUNING_PRESETS) {
    const v = version as ScannerTuningVersion
    return { version: v, tuning: SCANNER_TUNING_PRESETS[v] }
  }
  return { version: DEFAULT_TUNING_VERSION, tuning: DEFAULT_TUNING }
}
