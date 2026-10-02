// Exibicao/entrada de moeda no web. Mesma regra da API
// (api/src/modules/finance/finance.money.ts) — a paridade e verificada em
// finance-money.test.ts. Nenhum calculo financeiro acontece no navegador: os
// valores vem prontos do motor no servidor.

/** 1234567 -> "R$ 12.345,67" */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  const negative = cents < 0
  const abs = Math.abs(cents)
  const reais = Math.floor(abs / 100)
  const centavos = String(abs % 100).padStart(2, '0')
  const reaisText = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negative ? '-' : ''}R$ ${reaisText},${centavos}`
}

/** 250 -> "2,50%" */
export function formatBasisPoints(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return 'não configurado'
  return `${Math.floor(bps / 100)},${String(bps % 100).padStart(2, '0')}%`
}

/** "12.000,50" | "12000,50" | "12000" -> centavos; null se invalido. */
export function parseBRLToCents(input: string): number | null {
  const cleaned = input.replace(/R\$|\s/g, '')
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(cleaned))
    return null
  const [whole = '0', fraction = ''] = cleaned.replace(/\./g, '').split(',')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

/** "2,5" | "2.5" | "0" -> pontos base; null se invalido. */
export function parsePercentToBasisPoints(input: string): number | null {
  const cleaned = input.replace(/%|\s/g, '').replace(',', '.')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole = '0', fraction = ''] = cleaned.split('.')
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return bps <= 10_000 ? bps : null
}

/** "2026-09-29" -> "29/09/2026" (data civil, sem fuso). */
export function formatCivilDate(date: string | null | undefined): string {
  if (!date) return '—'
  const [y, m, d] = date.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** Instante UTC -> data/hora em America/Sao_Paulo. */
export function formatInstant(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

/** Instante -> data civil em America/Sao_Paulo (YYYY-MM-DD). */
export function instantToCivil(value: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

/** Data civil de hoje em America/Sao_Paulo (YYYY-MM-DD). */
export function todayCivil(): string {
  return instantToCivil(new Date())
}
