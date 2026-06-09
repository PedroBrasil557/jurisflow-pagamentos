import JSZip from 'jszip'
import { ServiceError } from '../errors/service-error'
import {
  getStorageObjectBytes,
  type StorageBucketName,
  storageBuckets,
} from './s3'

// Teto do total dos arquivos-fonte. O ZIP e montado em memoria, entao sem limite
// um processo com muitos/grandes PDFs poderia estourar a RAM da API.
const MAX_ZIP_SOURCE_BYTES = 200 * 1024 * 1024 // 200 MB
const KNOWN_BUCKETS = new Set<string>(Object.values(storageBuckets))

// Valida o bucket vindo do banco em vez de fazer cast cego para o tipo.
function assertKnownBucket(bucketName: string): StorageBucketName {
  if (!KNOWN_BUCKETS.has(bucketName)) {
    throw new ServiceError(500, 'Bucket de armazenamento invalido.')
  }
  return bucketName as StorageBucketName
}

export type ZipObjectEntry = {
  bucketName: string
  objectKey: string
  fileName: string
}

// Achata o nome: "/" e "\" viram "-" para o JSZip nao criar subpastas/diretorios
// vazios (rotulos de documento contem barras, ex.: "RG/CPF/CNH").
function flattenName(name: string): string {
  return name.replace(/[\\/]+/g, '-')
}

// Garante nomes unicos no ZIP: "arquivo.pdf", "arquivo (2).pdf", ...
function uniqueFileName(name: string, used: Map<string, number>): string {
  const seen = used.get(name) ?? 0
  used.set(name, seen + 1)

  if (seen === 0) {
    return name
  }

  const dot = name.lastIndexOf('.')
  if (dot <= 0) {
    return `${name} (${seen + 1})`
  }
  return `${name.slice(0, dot)} (${seen + 1})${name.slice(dot)}`
}

// Le os objetos do storage e monta um unico ZIP em memoria. Base do "baixar
// todos" via download unico (evita o bloqueio de multiplos downloads do
// navegador e problemas de CORS por arquivo das URLs assinadas).
export async function createStorageObjectsZip(
  entries: readonly ZipObjectEntry[],
): Promise<ArrayBuffer> {
  const zip = new JSZip()
  const used = new Map<string, number>()

  // Carrega sequencialmente (nao tudo de uma vez) e limita o total: evita segurar
  // todos os bytes + o ZIP em memoria simultaneamente.
  let totalBytes = 0
  for (const entry of entries) {
    const bytes = await getStorageObjectBytes({
      bucketName: assertKnownBucket(entry.bucketName),
      objectKey: entry.objectKey,
    })

    totalBytes += bytes.byteLength
    if (totalBytes > MAX_ZIP_SOURCE_BYTES) {
      throw new ServiceError(
        413,
        'Os documentos somam mais de 200 MB. Baixe-os individualmente.',
      )
    }

    zip.file(uniqueFileName(flattenName(entry.fileName), used), bytes)
  }

  return zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}
