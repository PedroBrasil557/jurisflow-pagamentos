// Classificacao DETERMINISTICA do flag "Averbacao" a partir do texto do termo de
// quitacao (Declaracao de Quitacao da Caixa). Documento oficial padronizado +
// frase fixa => match deterministico (sem IA/OCR): preciso, gratis, ~ms, auditavel.
//
// Sutileza confirmada em termos reais: a palavra "averbacao" aparece TAMBEM no
// template NEGATIVO ("nao foi possivel emitir o termo ... para averbacao ..."),
// entao o discriminador correto e a FRASE "procedimento de averbacao", nao a palavra.

export type AverbacaoFlag = 'sim' | 'nao' | 'indeterminado'

// minusculas + remove acentos (combinantes U+0300-U+036F apos NFD) + colapsa
// espacos/quebras (o PDF quebra o texto em varias runs/linhas).
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Minimo de texto util para considerar o PDF "lido". Abaixo disso (vazio/ilegivel)
// => fail-closed em 'indeterminado' (nao marca 'nao' num PDF que nao conseguimos ler).
const MIN_TEXT_CHARS = 50

export function classifyAverbacao(text: string): AverbacaoFlag {
  const norm = normalize(text)
  if (norm.length < MIN_TEXT_CHARS) return 'indeterminado'
  // POSITIVO: a frase-alvo.
  if (norm.includes('procedimento de averbacao')) return 'sim'
  // NEGATIVO: sem a frase positiva, mas menciona averbacao.
  if (norm.includes('averba')) return 'nao'
  // Template desconhecido (nem a frase, nem "averba") -> revisao manual.
  return 'indeterminado'
}
