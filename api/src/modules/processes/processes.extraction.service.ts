import { env } from '../../shared/config/env'
import { ServiceError } from '../../shared/errors/service-error'
import { normalizeExtraction } from './processes.extraction.normalizer'
import { createAnthropicVisionProvider } from './processes.extraction.provider'
import type {
  ExtractionInputFile,
  ExtractionMediaType,
  ExtractionResult,
} from './processes.extraction.types'

const MAX_FILES = 8
const MAX_FILE_SIZE_IN_BYTES = 15 * 1024 * 1024 // 15 MB por arquivo

const SUPPORTED_MEDIA_TYPES: Record<string, ExtractionMediaType> = {
  'application/pdf': 'application/pdf',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
}

function resolveMediaType(file: File): ExtractionMediaType {
  const mediaType = SUPPORTED_MEDIA_TYPES[file.type.toLowerCase()]

  if (!mediaType) {
    throw new ServiceError(
      415,
      `Formato nao suportado em "${file.name}". Envie PDF, JPG, PNG ou WEBP.`,
    )
  }

  return mediaType
}

async function toExtractionInputFile(file: File): Promise<ExtractionInputFile> {
  if (file.size === 0) {
    throw new ServiceError(400, `O arquivo "${file.name}" esta vazio.`)
  }

  if (file.size > MAX_FILE_SIZE_IN_BYTES) {
    throw new ServiceError(
      413,
      `O arquivo "${file.name}" excede o tamanho maximo de 15 MB.`,
    )
  }

  const mediaType = resolveMediaType(file)
  const buffer = await file.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')

  return {
    base64,
    kind: mediaType === 'application/pdf' ? 'pdf' : 'image',
    mediaType,
  }
}

// Extrai dados do titular e do endereco a partir dos documentos enviados.
// Stateless: nao grava nada e nao armazena os arquivos.
export async function extractDocumentsFromFiles(
  files: File[],
): Promise<ExtractionResult> {
  const apiKey = env.anthropic.apiKey

  if (!apiKey) {
    throw new ServiceError(
      503,
      'Extracao de documentos nao configurada. Defina ANTHROPIC_API_KEY no servidor.',
    )
  }

  if (files.length === 0) {
    throw new ServiceError(400, 'Envie ao menos um documento para extracao.')
  }

  if (files.length > MAX_FILES) {
    throw new ServiceError(
      413,
      `Envie no maximo ${MAX_FILES} arquivos por extracao.`,
    )
  }

  const inputFiles = await Promise.all(files.map(toExtractionInputFile))

  const provider = createAnthropicVisionProvider(apiKey, env.anthropic.model)
  const raw = await provider.extract(inputFiles)

  return normalizeExtraction(raw)
}
