// Normalizacao deterministica de nome para comparacao exata: remove acentos,
// caixa alta, colapsa espacos internos e apara as pontas. NAO faz fuzzy/typo —
// a comparacao do contrato Caixa so auto-aplica em match IDENTICO (precisao);
// variacoes legitimas caem em revisao humana, de proposito.
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}
