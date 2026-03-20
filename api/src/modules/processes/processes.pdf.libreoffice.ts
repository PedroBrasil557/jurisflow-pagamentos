import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let conversionQueue: Promise<void> = Promise.resolve()

function runLibreOffice(inputPath: string, outputDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn('libreoffice', [
      '--headless',
      '--norestore',
      '--convert-to',
      'pdf',
      '--outdir',
      outputDir,
      inputPath,
    ])

    let stderr = ''

    process.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    process.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`LibreOffice exited with code ${code}: ${stderr}`))
      }
    })

    process.on('error', (err) => {
      reject(new Error(`Failed to spawn LibreOffice: ${err.message}`))
    })
  })
}

export async function convertDocxToPdf(
  docxBuffer: Buffer | Uint8Array,
): Promise<Uint8Array> {
  const workDir = join(tmpdir(), `docx-to-pdf-${crypto.randomUUID()}`)

  const task = async () => {
    await mkdir(workDir, { recursive: true })

    try {
      const inputPath = join(workDir, 'input.docx')
      const outputPath = join(workDir, 'input.pdf')

      await writeFile(inputPath, docxBuffer)
      await runLibreOffice(inputPath, workDir)

      const pdfBytes = await readFile(outputPath)
      return new Uint8Array(pdfBytes)
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  // Serialize LibreOffice calls — it's not thread-safe
  const result = new Promise<Uint8Array>((resolve, reject) => {
    conversionQueue = conversionQueue
      .then(() => task().then(resolve, reject))
      .catch(() => undefined)
  })

  return result
}
