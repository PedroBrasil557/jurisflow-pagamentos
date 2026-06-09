import JSZip from 'jszip'
import { getStorageObjectBytes, type StorageBucketName } from './s3'

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

  const loaded = await Promise.all(
    entries.map(async (entry) => ({
      fileName: entry.fileName,
      bytes: await getStorageObjectBytes({
        bucketName: entry.bucketName as StorageBucketName,
        objectKey: entry.objectKey,
      }),
    })),
  )

  for (const item of loaded) {
    zip.file(uniqueFileName(flattenName(item.fileName), used), item.bytes)
  }

  return zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}
