import type { ImageSource } from '../scanner-engine'
import { INPUT_SIZE } from './config'

export type PreprocessResult = {
  data: Float32Array
  sourceWidth: number
  sourceHeight: number
}

function sourceDimensions(source: ImageSource): { w: number; h: number } {
  if ('naturalWidth' in source) {
    return {
      w: source.naturalWidth || source.width,
      h: source.naturalHeight || source.height,
    }
  }
  return { w: source.width, h: source.height }
}

// Prepara a entrada do modelo DocAligner heatmap: redimensiona a fonte para
// INPUT_SIZE x INPUT_SIZE (stretch, sem preservar aspecto — e o que o modelo
// espera), monta o tensor NCHW em ordem BGR e normaliza por /255. Guarda as
// dimensoes originais para mapear os cantos de volta no postprocess.
export function preprocess(source: ImageSource): PreprocessResult {
  const { w: sourceWidth, h: sourceHeight } = sourceDimensions(source)

  const canvas = document.createElement('canvas')
  canvas.width = INPUT_SIZE
  canvas.height = INPUT_SIZE
  // willReadFrequently: este canvas e lido com getImageData a cada frame. Sem a
  // flag, sob aceleracao de GPU o Chrome pode passar a devolver leitura
  // preta/defasada apos um tempo — zerando o brilho/confianca da deteccao.
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Canvas 2D indisponivel para o DocAligner.')
  }
  ctx.drawImage(source, 0, 0, INPUT_SIZE, INPUT_SIZE)

  const { data: rgba } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE)
  const area = INPUT_SIZE * INPUT_SIZE
  const data = new Float32Array(area * 3)

  // NCHW planar, ordem BGR (canal 0 = B, 1 = G, 2 = R), valores em [0,1].
  for (let i = 0; i < area; i++) {
    data[i] = rgba[i * 4 + 2] / 255 // B
    data[area + i] = rgba[i * 4 + 1] / 255 // G
    data[area * 2 + i] = rgba[i * 4] / 255 // R
  }

  return { data, sourceWidth, sourceHeight }
}
