// CLI do harness offline de avaliacao do scanner. Le fixtures rotuladas +
// detections (quads CRUS do DocAligner) e imprime, por preset de tuning, o IoU
// medio, % de conteudo (assinatura) cortado, % de fallback e % marcado para
// revisao. Assim se decide, sem risco em prod, qual config recorta melhor.
//
// Uso:
//   bun scripts/scanner-bench.ts [labels.json] [detections.json]
// Sem args, usa bench-fixtures/labels.json e detections.json. Ver
// bench-fixtures/README.md para o formato e como capturar os detections.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type BenchDetection,
  type BenchFixture,
  runAllPresets,
} from '../src/shared/components/document-scanner/scanner-bench'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(
  here,
  '../src/shared/components/document-scanner/bench-fixtures',
)

const labelsPath = process.argv[2] ?? resolve(fixturesDir, 'labels.json')
const detectionsPath =
  process.argv[3] ?? resolve(fixturesDir, 'detections.json')

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    console.error(
      `Nao foi possivel ler ${path}.\n` +
        'Crie o arquivo a partir dos exemplos em bench-fixtures/ (ver README.md),\n' +
        'ou rode apontando para os exemplos:\n' +
        '  bun scripts/scanner-bench.ts \\\n' +
        '    src/shared/components/document-scanner/bench-fixtures/labels.example.json \\\n' +
        '    src/shared/components/document-scanner/bench-fixtures/detections.example.json',
    )
    process.exit(1)
  }
}

const fixtures = readJson<BenchFixture[]>(labelsPath)
const detections = readJson<BenchDetection[]>(detectionsPath)

const reports = runAllPresets(fixtures, detections)

// Melhor primeiro: menos conteudo cortado, desempate por maior IoU.
const ranked = [...reports].sort(
  (a, b) => a.pctContentClipped - b.pctContentClipped || b.meanIoU - a.meanIoU,
)

const pad = (s: string, n: number) => s.padEnd(n)
const num = (x: number, d = 1) => x.toFixed(d)

console.log(
  `\nFixtures: ${fixtures.length}  |  detections: ${detections.length}\n`,
)
console.log(
  pad('preset', 24) +
    pad('IoU', 8) +
    pad('%cortado', 10) +
    pad('%fallback', 11) +
    pad('%revisao', 10),
)
console.log('-'.repeat(63))
for (const r of ranked) {
  console.log(
    pad(r.version, 24) +
      pad(num(r.meanIoU, 3), 8) +
      pad(num(r.pctContentClipped), 10) +
      pad(num(r.pctFallback), 11) +
      pad(num(r.pctFlaggedForReview), 10),
  )
}
console.log(
  `\nMelhor por cobertura/IoU: ${ranked[0]?.version ?? '(sem fixtures)'}\n`,
)
