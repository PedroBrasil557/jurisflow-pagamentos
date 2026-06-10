export type ConsultaQuitacaoResult = 'quitado' | 'nao_encontrado' | 'erro'

export type ConsultaSignals = {
  // Estado do botao "Emitir declaracao" (#btnEmitirDeclaracao) apos a consulta.
  emitButtonEnabled: boolean
  emitButtonVisible: boolean
  // Texto do bloco "Resultado".
  resultMessage: string
}

// Mensagem oficial de ausencia de contrato (Portaria MCID nº 1.248/2023).
const NAO_ENCONTRADO = /n[ãa]o foi encontrado contrato/i

// Decisao DETERMINISTICA (sem IA). O sinal PRIMARIO e o estado do botao "Emitir
// declaracao": ele so fica habilitado/visivel quando ha contrato quitado. A
// mensagem so e usada para distinguir "nao encontrado" de um "erro" inesperado.
// (NAO usar "texto do body": a pagina contem texto explicativo com a palavra
// "quitado" sempre — daria falso positivo.)
export function classifyConsultaQuitacao(signals: ConsultaSignals): {
  result: ConsultaQuitacaoResult
  message: string
} {
  const message = signals.resultMessage.trim()

  if (signals.emitButtonEnabled && signals.emitButtonVisible) {
    return { result: 'quitado', message }
  }

  if (NAO_ENCONTRADO.test(message)) {
    return { result: 'nao_encontrado', message }
  }

  return { result: 'erro', message }
}
