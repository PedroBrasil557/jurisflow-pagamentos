import { useEffect, useRef, useState } from 'react'
import type { CornerDetector } from '../scanner-engine'
import { createDocAlignerDetector } from './detector'

export type DocAlignerStatus = 'idle' | 'loading' | 'ready' | 'error'

export { createDocAlignerDetector }

// Carrega o modelo DocAligner sob demanda (num Web Worker, so quando `enabled`)
// e devolve o detector pronto + status. Em erro (modelo ausente, incompativel,
// worker falhou), status 'error' e detector null — o chamador usa o OpenCV.
export function useDocAlignerDetector(enabled: boolean): {
  detector: CornerDetector | null
  status: DocAlignerStatus
} {
  const [status, setStatus] = useState<DocAlignerStatus>('idle')
  const detectorRef = useRef<CornerDetector | null>(null)

  useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false
    setStatus('loading')

    const detector = createDocAlignerDetector()
    detector
      .warmup()
      .then(() => {
        if (cancelled) {
          detector.dispose()
          return
        }
        detectorRef.current = detector
        setStatus('ready')
      })
      .catch((error) => {
        console.warn(
          '[docaligner] IA indisponível — usando OpenCV:',
          error instanceof Error ? error.message : error,
        )
        detector.dispose()
        if (!cancelled) {
          detectorRef.current = null
          setStatus('error')
        }
      })

    return () => {
      cancelled = true
      detectorRef.current = null
      detector.dispose()
    }
  }, [enabled])

  return {
    detector: status === 'ready' ? detectorRef.current : null,
    status,
  }
}
