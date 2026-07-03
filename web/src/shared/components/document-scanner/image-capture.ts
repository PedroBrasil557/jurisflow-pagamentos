// Foto do SENSOR via ImageCapture.takePhoto() (Chrome/Android; inexistente no
// WebKit/iOS, onde a captura de alta resolucao e a camera nativa via input
// capture). Troca o quadro de video (~2-8 MP, pipeline de video, foco de video)
// por um still real do sensor. QUALQUER falha devolve null e o chamador cai no
// frame de video — o caminho novo nunca fica pior que o comportamento antigo.

// Tipos minimos da API (o lib.dom do TypeScript nao os traz em todas as
// versoes; alguns WebViews expoem o construtor sem implementar os metodos —
// por isso todo acesso e defensivo).
type MediaSettingsRange = { max?: number; min?: number; step?: number }
type PhotoCapabilities = {
  imageWidth?: MediaSettingsRange
  imageHeight?: MediaSettingsRange
}
type PhotoSettings = { imageWidth?: number; imageHeight?: number }
interface ImageCaptureLike {
  getPhotoCapabilities(): Promise<PhotoCapabilities>
  takePhoto(settings?: PhotoSettings): Promise<Blob>
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike

export async function takeSensorPhoto(
  track: MediaStreamTrack,
): Promise<Blob | null> {
  const Ctor = (globalThis as { ImageCapture?: ImageCaptureCtor }).ImageCapture
  if (typeof Ctor !== 'function') {
    return null
  }
  try {
    const capture = new Ctor(track)

    // Pede a maior resolucao de FOTO do sensor. Sem isto, varios aparelhos
    // devolvem o still na resolucao do video e o ganho de nitidez some.
    let settings: PhotoSettings | undefined
    try {
      const caps = await capture.getPhotoCapabilities()
      if (caps.imageWidth?.max) {
        settings = { imageWidth: caps.imageWidth.max }
      }
    } catch {
      // Sem capabilities: segue com o default do aparelho.
    }

    try {
      return await capture.takePhoto(settings)
    } catch {
      // Alguns aparelhos rejeitam imageWidth fora da grade suportada; o
      // default ainda tende a ser melhor que o frame de video.
      return await capture.takePhoto()
    }
  } catch {
    return null
  }
}
