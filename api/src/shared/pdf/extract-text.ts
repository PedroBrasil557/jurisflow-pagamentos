import { extractText, getDocumentProxy } from 'unpdf'

// Extrai o texto (camada de texto) de um PDF DIGITAL. Best-effort: nunca lanca —
// retorna '' se o PDF nao tiver texto (escaneado/corrompido) ou falhar o parse.
// Os PDFs da Caixa (Declaracao de Quitacao) sao gerados pelo portal e tem camada
// de texto limpa, entao NAO precisa de OCR; OCR ficaria como fallback futuro.
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  try {
    // getDocumentProxy consome o buffer (evita "detached ArrayBuffer" em reuso).
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    // mergePages: true => `text` e uma unica string com o texto de todas as paginas.
    const { text } = await extractText(pdf, { mergePages: true })
    return text ?? ''
  } catch {
    return ''
  }
}
