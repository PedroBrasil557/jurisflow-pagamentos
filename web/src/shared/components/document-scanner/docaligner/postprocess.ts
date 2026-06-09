import type { CornerPoints } from '../scanner-engine'
import { HEATMAP_THRESHOLD } from './config'

type Centroid = { x: number; y: number }

// Centroide do MAIOR blob conectado (4-vizinhanca) acima do limiar, num canal
// do heatmap. Equivale ao "maior poligono -> centroide" do DocAligner em Python.
// Retorna null se nenhum pixel passar do limiar (canto nao encontrado).
function largestBlobCentroid(
  data: Float32Array,
  offset: number,
  width: number,
  height: number,
  threshold: number,
): Centroid | null {
  const visited = new Uint8Array(width * height)
  const stack: number[] = []
  let best: { sumX: number; sumY: number; count: number } | null = null

  for (let start = 0; start < width * height; start++) {
    if (visited[start] || data[offset + start] < threshold) {
      continue
    }

    let sumX = 0
    let sumY = 0
    let count = 0
    stack.length = 0
    stack.push(start)
    visited[start] = 1

    while (stack.length > 0) {
      const p = stack.pop() as number
      const px = p % width
      const py = (p / width) | 0
      sumX += px
      sumY += py
      count++

      const neighbors = [
        px > 0 ? p - 1 : -1,
        px < width - 1 ? p + 1 : -1,
        py > 0 ? p - width : -1,
        py < height - 1 ? p + width : -1,
      ]
      for (const n of neighbors) {
        if (n >= 0 && !visited[n] && data[offset + n] >= threshold) {
          visited[n] = 1
          stack.push(n)
        }
      }
    }

    if (!best || count > best.count) {
      best = { sumX, sumY, count }
    }
  }

  if (!best) {
    return null
  }
  return { x: best.sumX / best.count, y: best.sumY / best.count }
}

// Converte os 4 heatmaps (dims [1,4,H,W]) em 4 cantos no espaco da imagem
// original. Como o preprocess faz stretch direto para INPUT_SIZE, o mapeamento
// heatmap -> fonte e linear. A ordem dos canais e arbitraria — quem chama
// normaliza com orderCorners(). Retorna null se algum canto faltar.
export function postprocessHeatmap(
  heatmap: Float32Array,
  heatmapHeight: number,
  heatmapWidth: number,
  sourceWidth: number,
  sourceHeight: number,
): CornerPoints | null {
  const plane = heatmapHeight * heatmapWidth
  const points: Centroid[] = []

  for (let channel = 0; channel < 4; channel++) {
    const centroid = largestBlobCentroid(
      heatmap,
      channel * plane,
      heatmapWidth,
      heatmapHeight,
      HEATMAP_THRESHOLD,
    )
    if (!centroid) {
      return null
    }
    points.push({
      x: (centroid.x / heatmapWidth) * sourceWidth,
      y: (centroid.y / heatmapHeight) * sourceHeight,
    })
  }

  return {
    topLeftCorner: points[0],
    topRightCorner: points[1],
    bottomRightCorner: points[2],
    bottomLeftCorner: points[3],
  }
}
