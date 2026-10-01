import type { ResolvedPermissions } from '@/features/permissions/services/permissions.service'

type Tone = 'success' | 'warning' | 'info' | 'error' | 'ghost'

export const receiptStatusLabels: Record<
  string,
  { label: string; tone: Tone }
> = {
  RASCUNHO: { label: 'Pendente', tone: 'warning' },
  EM_PREVIA: { label: 'Em distribuição', tone: 'info' },
  BLOQUEADO: { label: 'Revisar regras', tone: 'error' },
  APTO: { label: 'Pronta para finalizar', tone: 'success' },
  FECHADO: { label: 'Finalizada', tone: 'success' },
  CANCELADO: { label: 'Cancelada', tone: 'ghost' },
}

export const creditStatusLabels: Record<string, { label: string; tone: Tone }> =
  {
    ABERTO: { label: 'A pagar', tone: 'warning' },
    PARCIALMENTE_PAGO: { label: 'Pago parcialmente', tone: 'info' },
    PAGO: { label: 'Pago', tone: 'success' },
    ESTORNADO: { label: 'Estornado', tone: 'ghost' },
  }

export const receiptKindLabels: Record<string, string> = {
  HONORARIOS_CONTRATUAIS: 'Honorários contratuais',
  SUCUMBENCIA: 'Sucumbência',
  MULTA: 'Multa',
}

/**
 * Labels operacionais. Os códigos/letras do motor continuam existindo na memória
 * técnica, mas não são a linguagem principal da operação diária.
 */
export const stageLabels: Record<
  string,
  { label: string; base: string; help: string }
> = {
  PROVISAO_RECEITA: {
    label: 'Provisão sobre o valor recebido',
    base: 'valor bruto recebido',
    help: 'Separa uma parte do valor que entrou antes das demais distribuições.',
  },
  DEDUCAO_LIQUIDA: {
    label: 'Destino sobre a receita líquida',
    base: 'receita líquida após as provisões iniciais',
    help: 'Destina percentual ou valor para recebedores ou provisões calculadas sobre a receita líquida.',
  },
  RESERVA: {
    label: 'Reserva para uma finalidade',
    base: 'valor fixo ou percentual da receita líquida',
    help: 'Separa dinheiro para uma finalidade específica, com saldo e movimentos próprios.',
  },
  PARTICIPACAO_RESULTADO: {
    label: 'Participação sobre o resultado intermediário',
    base: 'resultado depois das deduções e reservas',
    help: 'Calcula a participação de um recebedor depois das deduções anteriores.',
  },
  DISTRIBUICAO_FINAL: {
    label: 'Distribuição do saldo final',
    base: 'saldo disponível para a distribuição final',
    help: 'Define quem recebe o saldo restante depois das etapas anteriores.',
  },
}

export const stageOrder = [
  'PROVISAO_RECEITA',
  'DEDUCAO_LIQUIDA',
  'RESERVA',
  'PARTICIPACAO_RESULTADO',
  'DISTRIBUICAO_FINAL',
] as const

export const natureLabels: Record<string, string> = {
  CREDITO: 'Recebedor',
  PROVISAO: 'Provisão',
  RESERVA: 'Reserva',
}

export const stageNatures: Record<string, string[]> = {
  PROVISAO_RECEITA: ['PROVISAO'],
  DEDUCAO_LIQUIDA: ['CREDITO', 'PROVISAO'],
  RESERVA: ['RESERVA'],
  PARTICIPACAO_RESULTADO: ['CREDITO'],
  DISTRIBUICAO_FINAL: ['CREDITO'],
}

export const statementKindLabels: Record<string, string> = {
  CREDITO: 'Valor liberado',
  AJUSTE: 'Ajuste',
  BAIXA: 'Pagamento registrado',
  ESTORNO_BAIXA: 'Estorno de pagamento',
  ESTORNO_CREDITO: 'Estorno de valor liberado',
}

// Espelha a autorizacao da API (que e a fonte de verdade): esconde o que o
// servidor recusaria. Operacoes globais exigem escopo de todos os processos.
function isGlobal(p: ResolvedPermissions) {
  return p.isAdmin || p.processScope === 'all'
}
export const financeAccess = {
  view: (p: ResolvedPermissions) => p.permissions.financeiro.view,
  lancar: (p: ResolvedPermissions) => p.permissions.financeiro.lancar,
  conferir: (p: ResolvedPermissions) => p.permissions.financeiro.conferir,
  fechar: (p: ResolvedPermissions) =>
    p.permissions.financeiro.fechar && isGlobal(p),
  baixar: (p: ResolvedPermissions) =>
    p.permissions.financeiro.baixar && isGlobal(p),
  regras: (p: ResolvedPermissions) =>
    p.permissions.financeiro.regras && isGlobal(p),
  importar: (p: ResolvedPermissions) =>
    p.permissions.financeiro.importar && isGlobal(p),
  reservas: (p: ResolvedPermissions) =>
    p.permissions.financeiro.reservas && isGlobal(p),
  estornar: (p: ResolvedPermissions) =>
    p.permissions.financeiro.estornar && isGlobal(p),
  exportar: (p: ResolvedPermissions) => p.permissions.financeiro.exportar,
}
