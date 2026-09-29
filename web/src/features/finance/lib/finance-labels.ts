import type { ResolvedPermissions } from '@/features/permissions/services/permissions.service'

type Tone = 'success' | 'warning' | 'info' | 'error' | 'ghost'

export const receiptStatusLabels: Record<
  string,
  { label: string; tone: Tone }
> = {
  RASCUNHO: { label: 'Rascunho', tone: 'ghost' },
  EM_PREVIA: { label: 'Em prévia', tone: 'info' },
  BLOQUEADO: { label: 'Bloqueado', tone: 'error' },
  APTO: { label: 'Apto', tone: 'success' },
  FECHADO: { label: 'Fechado', tone: 'success' },
  CANCELADO: { label: 'Cancelado', tone: 'ghost' },
}

export const creditStatusLabels: Record<string, { label: string; tone: Tone }> =
  {
    ABERTO: { label: 'A pagar', tone: 'warning' },
    PARCIALMENTE_PAGO: { label: 'Parcialmente pago', tone: 'info' },
    PAGO: { label: 'Pago', tone: 'success' },
    ESTORNADO: { label: 'Estornado', tone: 'ghost' },
  }

export const receiptKindLabels: Record<string, string> = {
  HONORARIOS_CONTRATUAIS: 'Honorários contratuais',
  SUCUMBENCIA: 'Sucumbência',
  MULTA: 'Multa',
}

export const stageLabels: Record<string, { label: string; base: string }> = {
  PROVISAO_RECEITA: {
    label: 'Provisões sobre a receita (B)',
    base: 'A · receita total',
  },
  DEDUCAO_LIQUIDA: {
    label: 'Deduções e participações (E–H)',
    base: 'C · receita líquida',
  },
  RESERVA: { label: 'Reservas (I)', base: 'valor fixo ou % de C' },
  PARTICIPACAO_RESULTADO: {
    label: 'Participações sobre o resultado 1 (L)',
    base: 'J · resultado 1',
  },
  DISTRIBUICAO_FINAL: {
    label: 'Distribuição final (N)',
    base: 'M · resultado 2',
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
  CREDITO: 'Crédito a recebedor',
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
  CREDITO: 'Crédito',
  AJUSTE: 'Ajuste',
  BAIXA: 'Baixa',
  ESTORNO_BAIXA: 'Estorno de baixa',
  ESTORNO_CREDITO: 'Estorno de crédito',
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
