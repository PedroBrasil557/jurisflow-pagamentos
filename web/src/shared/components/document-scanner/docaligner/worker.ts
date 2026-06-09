/// <reference lib="webworker" />
// Web Worker do DocAligner: roda a inferencia ONNX (pesada, ~200-400ms no WASM)
// fora da thread principal, para o preview ao vivo nao travar o video. Recebe o
// tensor ja pre-processado (Float32 NCHW) e devolve os 4 cantos crus em
// coordenadas da imagem original (a ordenacao/validacao fica na thread
// principal, evitando importar scanner-engine/React aqui).
import type { CornerPoints } from '../scanner-engine'
import { INPUT_SIZE } from './config'
import { postprocessHeatmap } from './postprocess'
import { createTensor, getSession } from './runtime'

const ctx = self as unknown as DedicatedWorkerGlobalScope

type InferMessage = {
  type: 'infer'
  id: number
  data: Float32Array
  sourceWidth: number
  sourceHeight: number
}
type WarmupMessage = { type: 'warmup' }
type IncomingMessage = InferMessage | WarmupMessage

async function runInfer(
  data: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
): Promise<CornerPoints | null> {
  const session = await getSession()
  const input = await createTensor(data, [1, 3, INPUT_SIZE, INPUT_SIZE])
  const results = await session.run({ [session.inputNames[0]]: input })
  const heatmap = results[session.outputNames[0]]
  if (!heatmap || heatmap.dims.length < 4) {
    return null
  }
  return postprocessHeatmap(
    heatmap.data,
    Number(heatmap.dims[2]),
    Number(heatmap.dims[3]),
    sourceWidth,
    sourceHeight,
  )
}

ctx.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data

  if (message.type === 'warmup') {
    try {
      await getSession()
      // Primeira inferencia "a frio" compila os kernels WASM; aquecemos com um
      // tensor zerado para o primeiro frame real ja sair rapido.
      await runInfer(new Float32Array(INPUT_SIZE * INPUT_SIZE * 3), 1, 1)
      ctx.postMessage({ type: 'ready' })
    } catch (error) {
      console.error('[docaligner worker] falha ao iniciar', error)
      ctx.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
    return
  }

  try {
    const corners = await runInfer(
      message.data,
      message.sourceWidth,
      message.sourceHeight,
    )
    ctx.postMessage({ type: 'result', id: message.id, corners })
  } catch {
    ctx.postMessage({ type: 'result', id: message.id, corners: null })
  }
}
