// Telemetria de captura por pagina, enviada no scan/complete (a API apenas
// loga no evento scan.complete). E o dado que responde, em prod: qual caminho
// de captura os aparelhos usam, que resolucao BRUTA entregam (antes do teto de
// normalizacao de ~3500px — sem isto o ganho do still HD ficaria invisivel) e
// como calibrar os limiares do gate de qualidade (sharpness/glare/sombra).

// De onde veio a imagem da pagina:
// 'still' = ImageCapture.takePhoto (Android) | 'frame' = quadro do viewfinder |
// 'native' = camera nativa via input capture (iOS "Alta resolucao").
export type ScanCaptureSource = 'still' | 'frame' | 'native'

export type ScanPageTelemetry = {
  // Lado longo (px) da pagina FINAL (normalizada <=3500 e recortada).
  longEdgePx: number
  // Lado longo (px) da captura BRUTA, antes da normalizacao (quando conhecido).
  rawLongEdgePx?: number
  source?: ScanCaptureSource
  // Metricas do gate de qualidade (modo HD), para calibracao dos limiares.
  sharpness?: number
  tenengrad?: number
  glareRatio?: number
  shadowRatio?: number
}
