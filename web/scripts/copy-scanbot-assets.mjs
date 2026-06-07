// Copia os assets WASM do Scanbot Web SDK para public/vendor/document-scanner,
// onde o Vite os serve em /vendor/document-scanner/ (dev e build).
// Roda antes de `dev` e `build` (ver package.json). Mantemos esses binarios
// (~24 MB) fora do git via .gitignore.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(
  root,
  'node_modules/scanbot-web-sdk/bundle/bin/document-scanner',
)
const destination = resolve(root, 'public/vendor/document-scanner')

if (!existsSync(source)) {
  console.error(
    `[scanbot] assets nao encontrados em ${source}. Rode a instalacao de dependencias.`,
  )
  process.exit(1)
}

mkdirSync(destination, { recursive: true })
cpSync(source, destination, { recursive: true })
console.log(`[scanbot] assets copiados para ${destination}`)
