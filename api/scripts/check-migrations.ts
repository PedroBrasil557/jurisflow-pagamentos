import fs from 'node:fs'
import path from 'node:path'

type MigrationJournal = {
  entries?: Array<{
    idx: number
    tag: string
    when: number
  }>
}

const journalPath = path.join(import.meta.dir, '../drizzle/meta/_journal.json')
const journal = JSON.parse(
  fs.readFileSync(journalPath, 'utf8'),
) as MigrationJournal

if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
  throw new Error('Nenhuma migration encontrada em drizzle/meta/_journal.json.')
}

for (let index = 0; index < journal.entries.length; index += 1) {
  const entry = journal.entries[index]

  if (!entry) {
    continue
  }

  if (entry.idx !== index) {
    throw new Error(
      `Migration ${entry.tag} possui idx ${entry.idx}, esperado ${index}.`,
    )
  }

  const previousEntries = journal.entries.slice(0, index)
  const maxPreviousWhen = previousEntries.reduce(
    (currentMax, currentEntry) => Math.max(currentMax, currentEntry?.when ?? 0),
    0,
  )

  if (index === journal.entries.length - 1 && entry.when <= maxPreviousWhen) {
    throw new Error(
      [
        'A migration mais recente do Drizzle nao pode ter timestamp menor ou igual ao historico anterior.',
        `${entry.tag} possui when=${entry.when}.`,
        `Maior when anterior encontrado: ${maxPreviousWhen}.`,
        'Gere novamente a migration ou ajuste o fluxo antes de fazer deploy.',
      ].join(' '),
    )
  }
}

console.log(`Migration journal OK: ${journal.entries.length} entries valid.`)
