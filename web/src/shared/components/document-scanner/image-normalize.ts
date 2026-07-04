// Normalizacao de imagem na captura — o passo que mantem o scanner viavel em
// Android de baixa RAM. Uma foto de 50 MP, decodificada inteira num canvas, vira
// ~200 MB de bitmap RGBA e mata a aba. Aqui a imagem e decodificada JA REDUZIDA
// (createImageBitmap com resize) e nunca materializa a resolucao cheia.
//
// O que importa para OCR/legibilidade de documento e DPI, nao megapixels: A4 a
// ~3500px de lado longo ja e ~300 DPI (padrao de arquivo). Reduzir a isso nao
// degrada o documento — e, vindo de um still de 50 MP, resulta ate mais nitido
// que o frame de video (~4K) do caminho ao vivo.

// A4 a 300 DPI ≈ 3508px no lado longo. Teto do lado longo de cada pagina.
export const MAX_PAGE_LONG_EDGE = 3500

// Qualidade JPEG final de cada pagina (documento tolera bem; 0.90 mantem texto).
export const PAGE_JPEG_QUALITY = 0.9

// Em aparelhos com pouca RAM, reduz ainda mais o teto para folgar memoria.
// `navigator.deviceMemory` (Chrome/Android) da uma dica grosseira em GB.
export function resolveMaxLongEdge(): number {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (typeof mem === 'number' && mem > 0 && mem <= 3) {
    return 2600 // ~220 DPI: ainda acima do piso de OCR (200 DPI)
  }
  return MAX_PAGE_LONG_EDGE
}

// `createImageBitmap(blob, { resizeWidth, resizeQuality })` e a UNICA API que
// decodifica JA reduzido (sem materializar a imagem cheia). Chrome/Android honra;
// WebKit/iOS e WebViews antigas ignoram as opcoes de resize. Feature-detect
// aproximado: assumimos suporte quando `createImageBitmap` existe e degradamos
// no fallback (o caminho de video ja entrega quadros pequenos, entao o risco real
// e so o still nativo).
function supportsCreateImageBitmap(): boolean {
  return typeof createImageBitmap === 'function'
}

// Calcula as dimensoes de saida respeitando o teto do lado longo (sem upscale).
function fitLongEdge(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  if (longEdge <= maxLongEdge) {
    return { width, height }
  }
  const scale = maxLongEdge / longEdge
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }
}

function drawBitmapToCanvas(
  bitmap: ImageBitmap,
  target: { width: number; height: number },
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Nao foi possivel processar a imagem.')
  }
  ctx.drawImage(bitmap, 0, 0, target.width, target.height)
  return canvas
}

// Le a largura/altura de um JPEG a partir do header (marcador SOF), SEM
// decodificar os pixels — le so os primeiros KBs via blob.slice. Retorna null se
// nao for JPEG ou o header nao trouxer o SOF nesse trecho. E o que permite pedir
// o resize direto ao decoder sem antes materializar os 50 MP so para medir.
// Exportado: a estrategia de captura HD usa as dimensoes do header para detectar
// still "falso" (aparelho que devolve o frame de video no takePhoto).
export async function readJpegDimensions(
  source: Blob,
): Promise<{ width: number; height: number } | null> {
  try {
    const head = new Uint8Array(await source.slice(0, 128 * 1024).arrayBuffer())
    // Assinatura JPEG (SOI): FF D8.
    if (head.length < 4 || head[0] !== 0xff || head[1] !== 0xd8) {
      return null
    }
    let offset = 2
    while (offset + 9 < head.length) {
      if (head[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = head[offset + 1]
      // Marcadores SOF (C0..CF), exceto DHT(C4), JPG(C8) e DAC(CC): trazem as
      // dimensoes em [offset+5..8] (altura, depois largura), big-endian.
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      if (isSof) {
        const height = (head[offset + 5] << 8) | head[offset + 6]
        const width = (head[offset + 7] << 8) | head[offset + 8]
        return width > 0 && height > 0 ? { width, height } : null
      }
      // Segmentos com payload: pula pelo tamanho declarado (offset+2..3).
      const segmentLength = (head[offset + 2] << 8) | head[offset + 3]
      if (segmentLength < 2) {
        return null
      }
      offset += 2 + segmentLength
    }
    return null
  } catch {
    return null
  }
}

// Decodifica um arquivo/blob de imagem JA REDUZIDO a um canvas <= maxLongEdge.
// Fecha o ImageBitmap imediatamente (segura pixels decodificados ate close()).
export async function decodeToWorkingCanvas(
  source: Blob,
  maxLongEdge = resolveMaxLongEdge(),
): Promise<HTMLCanvasElement> {
  if (supportsCreateImageBitmap()) {
    // Mede pelo header (sem decode). Com as dimensoes, pede o resize direto ao
    // decoder — nunca materializa a imagem cheia (o pico de ~200 MB de 50 MP).
    const dims = await readJpegDimensions(source)
    let bitmap: ImageBitmap | null = null
    if (dims) {
      const target = fitLongEdge(dims.width, dims.height, maxLongEdge)
      try {
        bitmap = await createImageBitmap(source, {
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: 'high',
        })
      } catch {
        // Navegador sem suporte a resize: decodifica cheio e reduz no draw.
        bitmap = await createImageBitmap(source).catch(() => null)
      }
    } else {
      // Nao-JPEG (PNG/HEIC): sem header barato, decodifica e reduz ao desenhar.
      // HEIC pode falhar no createImageBitmap mesmo em WebKit — cai no <img>
      // abaixo, que usa o decoder nativo do sistema (Safari decodifica HEIC la).
      bitmap = await createImageBitmap(source).catch(() => null)
    }
    if (bitmap) {
      try {
        // Alvo recalculado a partir do bitmap: se o resize foi honrado, ja veio
        // no tamanho (draw identidade); se nao, reduz aqui.
        return drawBitmapToCanvas(
          bitmap,
          fitLongEdge(bitmap.width, bitmap.height, maxLongEdge),
        )
      } finally {
        bitmap.close()
      }
    }
  }

  // Fallback sem createImageBitmap (ou com decode recusado, ex.: HEIC): <img> +
  // draw reduzido (decodifica cheio uma vez — aceitavel so neste caminho).
  const url = URL.createObjectURL(source)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Nao foi possivel ler a imagem.'))
      img.src = url
    })
    const target = fitLongEdge(
      image.naturalWidth,
      image.naturalHeight,
      maxLongEdge,
    )
    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Nao foi possivel processar a imagem.')
    }
    ctx.drawImage(image, 0, 0, target.width, target.height)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Reduz um canvas ja existente (ex.: quadro de video) ao teto do lado longo.
// Retorna o mesmo canvas se ja couber (sem copia desnecessaria).
export function downscaleCanvasToLongEdge(
  source: HTMLCanvasElement,
  maxLongEdge = resolveMaxLongEdge(),
): HTMLCanvasElement {
  const target = fitLongEdge(source.width, source.height, maxLongEdge)
  if (target.width === source.width && target.height === source.height) {
    return source
  }
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  canvas.getContext('2d')?.drawImage(source, 0, 0, target.width, target.height)
  return canvas
}

// Gira um canvas 90 graus (sentido horario, o da montagem tipica do sensor
// traseiro Android). Usado quando o still do ImageCapture vem na orientacao do
// sensor (paisagem) com o viewfinder em retrato. Retorna a propria fonte se o
// contexto 2d nao estiver disponivel.
export function rotateCanvas90(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = source.height
  canvas.height = source.width
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return source
  }
  ctx.translate(canvas.width, 0)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(source, 0, 0)
  return canvas
}

// Converte um canvas em Blob JPEG (fora do heap de strings, ao contrario de
// toDataURL). Libera o canvas (width/height = 0) apos extrair.
export function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality = PAGE_JPEG_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Nao foi possivel gerar a imagem da pagina.'))
        }
      },
      'image/jpeg',
      quality,
    )
  })
}

// Libera o backing store de um canvas de trabalho apos o uso.
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}
