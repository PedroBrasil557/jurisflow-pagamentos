// Aritmetica monetaria exata: dinheiro em CENTAVOS inteiros, percentuais em PONTOS
// BASE (1 pb = 0,01%). Multiplicacoes em BigInt para nao perder precisao acima de
// 2^53. Nenhum ponto flutuante participa de calculo monetario.

export const BASIS_POINTS_SCALE = 10_000

export function assertCents(value: number, label = 'valor'): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} deve ser inteiro em centavos: ${value}`)
  }
}

export function assertBasisPoints(value: number, label = 'percentual'): void {
  if (!Number.isInteger(value) || value < 0 || value > BASIS_POINTS_SCALE) {
    throw new RangeError(`${label} deve estar entre 0 e 10000 pb: ${value}`)
  }
}

/** round(amount x bps / 10000) com arredondamento meio-para-cima (valores >= 0). */
export function percentOfCents(
  amountCents: number,
  basisPoints: number,
): number {
  assertCents(amountCents)
  assertBasisPoints(basisPoints)
  if (amountCents < 0) {
    throw new RangeError(
      'Percentual so e aplicado sobre valores nao negativos.',
    )
  }
  const scaled = BigInt(amountCents) * BigInt(basisPoints)
  const result =
    (scaled + BigInt(BASIS_POINTS_SCALE / 2)) / BigInt(BASIS_POINTS_SCALE)
  return Number(result)
}

export type ExactPercent = {
  /** parte inteira de amount x bps / 10000 (truncada) */
  floorCents: number
  /** resto da divisao por 10000 (0..9999) — fracao de centavo em 1/10000 */
  remainder: number
  /** arredondamento meio-para-cima */
  roundedCents: number
  /** valor exato em centavos com 4 casas, ex. "127.5000" (para a memoria) */
  exact: string
}

/** amount x bps / 10000 exato, com resto — base das politicas de arredondamento. */
export function exactPercentOfCents(
  amountCents: number,
  basisPoints: number,
): ExactPercent {
  const rounded = percentOfCents(amountCents, basisPoints)
  const scaled = BigInt(amountCents) * BigInt(basisPoints)
  const scale = BigInt(BASIS_POINTS_SCALE)
  const floorCents = Number(scaled / scale)
  const remainder = Number(scaled % scale)
  return {
    floorCents,
    remainder,
    roundedCents: rounded,
    exact: `${floorCents}.${String(remainder).padStart(4, '0')}`,
  }
}

/**
 * Percentual pt-BR/planilha -> pontos base. "2,5" | "2.5" | "2,50%" | "0" -> 250 | 0.
 * Maximo 2 casas decimais (0,01% = 1 pb). Retorna null se invalido ou fora de 0..100.
 */
export function parsePercentToBasisPoints(input: string): number | null {
  const cleaned = input.replace(/%|\s/g, '').replace(',', '.')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole = '0', fraction = ''] = cleaned.split('.')
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return bps <= BASIS_POINTS_SCALE ? bps : null
}

/** 1234567 -> "R$ 12.345,67" (determinístico, sem depender de ICU). */
export function formatCentsBRL(cents: number): string {
  assertCents(cents)
  const negative = cents < 0
  const abs = Math.abs(cents)
  const reais = Math.floor(abs / 100)
  const centavos = String(abs % 100).padStart(2, '0')
  const reaisText = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negative ? '-' : ''}R$ ${reaisText},${centavos}`
}

/** 2000 -> "20,00%" */
export function formatBasisPoints(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100)
  const fraction = String(basisPoints % 100).padStart(2, '0')
  return `${whole},${fraction}%`
}

/** Formato pt-BR: "12.000,50" | "12000,50" | "12000" -> centavos. Ponto = milhar. */
export function parseBRLToCents(input: string): number | null {
  const cleaned = input.replace(/R\$|\s/g, '')
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(cleaned)) {
    return null
  }
  const [whole = '0', fraction = ''] = cleaned.replace(/\./g, '').split(',')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}
