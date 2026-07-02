// Estado de consulta da quitacao POR CPF do(s) titular(es) do contrato Caixa.
// Modulo PURO (sem imports) — consumido pelo reconciliador (set-diff) e pelo
// servico de quitacao (claim/result), sem criar ciclo entre eles.

export type QuitacaoConsultaStatus =
  | 'pending'
  | 'quitado'
  | 'nao_encontrado'
  | 'erro'

export type QuitacaoConsulta = {
  cpf: string
  status: QuitacaoConsultaStatus
  checkedAt?: string // ISO
  message?: string
}

export type QuitacaoAggregate =
  | 'idle'
  | 'pending'
  | 'quitado'
  | 'nao_encontrado'
  | 'erro'

// Agrega o estado por-CPF no caixa_quitacao_status (dirige claim/UI). Precedencia:
// quitado VENCE (short-circuit — ja temos o termo) > pending (ha o que consultar) >
// erro (transitorio esgotado) > nao_encontrado (todos terminais sem quitar). Vazio = idle.
export function aggregateQuitacaoStatus(
  consultas: QuitacaoConsulta[],
): QuitacaoAggregate {
  if (consultas.length === 0) return 'idle'
  if (consultas.some((c) => c.status === 'quitado')) return 'quitado'
  if (consultas.some((c) => c.status === 'pending')) return 'pending'
  if (consultas.some((c) => c.status === 'erro')) return 'erro'
  return 'nao_encontrado'
}

// Mapeia o desfecho POR CPF (resultado do worker) para o estado da consulta.
// 'erro' e transitorio: volta a 'pending' (retry) ate as tentativas esgotarem.
// 'quitado' com FALHA ao anexar o termo NAO e terminal — a consulta e idempotente,
// entao volta a 'pending' para reprocessar (so vira 'erro' terminal se esgotou);
// terminar como 'erro' aqui PERDERIA uma quitacao ja confirmada pela Caixa.
export function nextConsultaStatus(
  result: 'quitado' | 'nao_encontrado' | 'erro',
  opts: { attachFailed: boolean; exhausted: boolean },
): QuitacaoConsultaStatus {
  if (result === 'quitado') {
    return opts.attachFailed ? (opts.exhausted ? 'erro' : 'pending') : 'quitado'
  }
  if (result === 'nao_encontrado') {
    return 'nao_encontrado'
  }
  return opts.exhausted ? 'erro' : 'pending'
}
