// Binarios do onnxruntime-web resolvidos pelo Vite via `?url` (a partir do
// node_modules). Importante: NAO servir esses .mjs/.wasm de public/, pois o Vite
// proibe importar modulos de public/ no dev — e o ORT faz `import()` do .mjs.
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { MODEL_URL } from './config'

// Tipos minimos do onnxruntime-web — evita acoplar ao shape exato do pacote e
// mantem o resto do modulo agnostico a versao.
export type OrtTensor = { data: Float32Array; dims: readonly number[] }
export type OrtSession = {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>
  inputNames: readonly string[]
  outputNames: readonly string[]
}
type OrtModule = {
  env: {
    wasm: {
      wasmPaths: string | { wasm?: string; mjs?: string }
      numThreads: number
      simd: boolean
    }
  }
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => OrtTensor
  InferenceSession: {
    create(path: string, options?: Record<string, unknown>): Promise<OrtSession>
  }
}

let ortModule: OrtModule | null = null
let sessionPromise: Promise<OrtSession> | null = null

async function loadOrt(): Promise<OrtModule> {
  if (!ortModule) {
    // Build SO-WASM (`/wasm`): nao referencia o loader jsep do WebGPU, ao
    // contrario do import padrao `onnxruntime-web` (build completo, que tenta
    // buscar ort-wasm-simd-threaded.jsep.mjs no init e quebra).
    const mod = (await import('onnxruntime-web/wasm')) as unknown as OrtModule
    // .wasm e .mjs servidos pelo Vite (via ?url); SIMD ligado. Single-thread por
    // padrao para nao exigir headers COOP/COEP (SharedArrayBuffer). Usa threads
    // apenas quando a pagina esta cross-origin isolated.
    mod.env.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl }
    mod.env.wasm.simd = true
    mod.env.wasm.numThreads =
      typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
        ? Math.min(4, navigator.hardwareConcurrency || 1)
        : 1
    ortModule = mod
  }
  return ortModule
}

// Cria a sessao de inferencia uma unica vez. Backend WASM (SIMD): leve e
// suficiente para inferencia sob demanda do scanner, sem o WASM jsep do WebGPU
// (~26 MB). Lanca se o modelo nao existir/for invalido — o detector trata o
// erro caindo no OpenCV.
export function getSession(): Promise<OrtSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await loadOrt()
      return ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })
    })().catch((error) => {
      sessionPromise = null
      throw error
    })
  }
  return sessionPromise
}

export async function createTensor(
  data: Float32Array,
  dims: number[],
): Promise<OrtTensor> {
  const ort = await loadOrt()
  return new ort.Tensor('float32', data, dims)
}
