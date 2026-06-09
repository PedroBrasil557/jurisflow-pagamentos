import {
  type CornerDetector,
  type CornerPoints,
  orderCorners,
  quadArea,
} from '../scanner-engine'
import { preprocess } from './preprocess'

type WorkerOut =
  | { type: 'ready' }
  | { type: 'error'; message?: string }
  | { type: 'result'; id: number; corners: CornerPoints | null }

export type DocAlignerDetector = CornerDetector & {
  warmup(): Promise<void>
  dispose(): void
}

// Detector DocAligner: pre-processa o frame na thread principal (canvas) e
// delega a inferencia ao Web Worker (off-main-thread, para o video ao vivo nao
// travar). Devolve 4 cantos ja ordenados/validados, ou null — sem fallback
// proprio (quem chama cai no OpenCV quando retorna null).
export function createDocAlignerDetector(): DocAlignerDetector {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  })

  let nextId = 1
  const pending = new Map<number, (corners: CornerPoints | null) => void>()
  let onReady: (() => void) | null = null
  let onReadyError: ((reason: unknown) => void) | null = null

  worker.onmessage = (event: MessageEvent<WorkerOut>) => {
    const message = event.data
    if (message.type === 'ready') {
      onReady?.()
      onReady = null
      onReadyError = null
      return
    }
    if (message.type === 'error') {
      onReadyError?.(
        new Error(
          message.message ?? 'Falha ao iniciar o worker do DocAligner.',
        ),
      )
      onReady = null
      onReadyError = null
      return
    }
    const resolve = pending.get(message.id)
    if (resolve) {
      pending.delete(message.id)
      resolve(message.corners)
    }
  }

  return {
    async detect(source) {
      try {
        const { data, sourceWidth, sourceHeight } = preprocess(source)
        const id = nextId++
        const raw = await new Promise<CornerPoints | null>((resolve) => {
          pending.set(id, resolve)
          // Transfere o buffer do tensor (sem copia) para o worker.
          worker.postMessage(
            { type: 'infer', id, data, sourceWidth, sourceHeight },
            [data.buffer],
          )
        })
        if (!raw) {
          return null
        }
        // Confiamos nos cantos do modelo (so o documento gera heatmap forte). So
        // descartamos deteccao degenerada/minuscula — NAO aplicamos o limite
        // superior do isPlausibleQuad: o documento PODE preencher o quadro
        // (cantos nas bordas ou levemente alem) e a estimativa segue valida.
        const ordered = orderCorners(raw)
        const imageArea = sourceWidth * sourceHeight
        return imageArea > 0 && quadArea(ordered) >= imageArea * 0.05
          ? ordered
          : null
      } catch {
        return null
      }
    },
    warmup() {
      return new Promise<void>((resolve, reject) => {
        onReady = resolve
        onReadyError = reject
        worker.postMessage({ type: 'warmup' })
      })
    },
    dispose() {
      worker.terminate()
      pending.clear()
    },
  }
}
