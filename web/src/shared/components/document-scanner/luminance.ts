// Luminancia Rec. 601 — fonte UNICA dos coeficientes no scanner: o gate de
// qualidade (sharpness.ts) e os filtros de realce (scan-enhance.ts) precisam
// medir/renderizar a MESMA luminancia; ajustar aqui muda os dois juntos.
export const LUMA_R = 0.299
export const LUMA_G = 0.587
export const LUMA_B = 0.114

// Forma escalar (para lacos por-pixel quentes — o JIT inlineia).
export function rec601Luma(r: number, g: number, b: number): number {
  return r * LUMA_R + g * LUMA_G + b * LUMA_B
}

// Converte ImageData RGBA em buffer de luminancia.
export function toLuminance(data: Uint8ClampedArray): Float32Array {
  const gray = new Float32Array(data.length / 4)
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4
    gray[i] = rec601Luma(data[o], data[o + 1], data[o + 2])
  }
  return gray
}
