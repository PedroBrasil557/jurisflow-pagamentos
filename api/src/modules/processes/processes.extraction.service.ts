import { env } from '../../shared/config/env'
import { ServiceError } from '../../shared/errors/service-error'
import { getAnthropicApiKey } from '../settings/settings.service'
import { normalizeExtraction } from './processes.extraction.normalizer'
import { createAnthropicVisionProvider } from './processes.extraction.provider'
import type {
  ExtractionInputFile,
  ExtractionMediaType,
  ExtractionRunResult,
} from './processes.extraction.types'

// O PDF empacotado reune varios documentos; limite alinhado ao Claude (~32 MB).
export const MAX_FILE_SIZE_IN_BYTES = 32 * 1024 * 1024

function resolveMediaType(file: File): ExtractionMediaType {
  if (file.type.toLowerCase() !== 'application/pdf') {
    throw new ServiceError(
      415,
      `Formato nao suportado em "${file.name}". Envie um unico arquivo PDF.`,
    )
  }

  return 'application/pdf'
}

async function toExtractionInputFile(file: File): Promise<ExtractionInputFile> {
  if (file.size === 0) {
    throw new ServiceError(400, `O arquivo "${file.name}" esta vazio.`)
  }

  if (file.size > MAX_FILE_SIZE_IN_BYTES) {
    throw new ServiceError(
      413,
      `O arquivo "${file.name}" excede o tamanho maximo de 32 MB.`,
    )
  }

  const mediaType = resolveMediaType(file)
  const buffer = await file.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')

  return {
    base64,
    kind: 'pdf',
    mediaType,
  }
}

// Extrai dados do titular e do endereco a partir dos documentos enviados.
// Stateless: nao grava nada e nao armazena os arquivos.
export async function extractDocumentsFromFiles(
  files: File[],
): Promise<ExtractionRunResult> {
  // Prioridade: chave salva no painel (banco) sobre a variavel de ambiente.
  const apiKey = (await getAnthropicApiKey()) ?? env.anthropic.apiKey

  if (!apiKey) {
    throw new ServiceError(
      503,
      'Extracao de documentos nao configurada. Defina a chave da API em Configuracoes ou via ANTHROPIC_API_KEY.',
    )
  }

  if (files.length !== 1) {
    throw new ServiceError(
      400,
      'Envie um unico arquivo PDF com todos os documentos.',
    )
  }

  const inputFiles = await Promise.all(files.map(toExtractionInputFile))

  const provider = createAnthropicVisionProvider(apiKey, env.anthropic.model)
  const { raw, model, usage } = await provider.extract(inputFiles)

  return {
    ...normalizeExtraction(raw),
    meta: {
      model,
      usage,
      paginas: raw.paginas ?? [],
      outorgantes: raw.outorgantes,
      compraVenda: raw.compraVenda,
    },
  }
}
