// Transicao pura do estado da consulta de quitacao por CPF. Modulo SEM imports,
// proprio da fila generica — NAO depende do modulo (legado) caixa-quitacao dos
// processos, mantendo titulares/quitacao-queue desacoplados de `processes`.

export type ConsultaState = 'pending' | 'quitado' | 'nao_encontrado' | 'erro'

// Mapeia o desfecho POR CPF (resultado do worker) para o proximo estado da consulta.
// 'erro' e transitorio: volta a 'pending' (retry) ate as tentativas esgotarem.
// 'quitado' com FALHA ao anexar o termo NAO e terminal — a consulta e idempotente,
// entao volta a 'pending' para reprocessar (so vira 'erro' terminal se esgotou);
// terminar como 'erro' aqui PERDERIA uma quitacao ja confirmada pela Caixa.
export function nextConsultaStatus(
  result: 'quitado' | 'nao_encontrado' | 'erro',
  opts: { attachFailed: boolean; exhausted: boolean },
): ConsultaState {
  if (result === 'quitado') {
    return opts.attachFailed ? (opts.exhausted ? 'erro' : 'pending') : 'quitado'
  }
  if (result === 'nao_encontrado') {
    return 'nao_encontrado'
  }
  return opts.exhausted ? 'erro' : 'pending'
}
