export const processStatuses = [
  'EM_DOCUMENTACAO',
  'DOCUMENTACAO_PRONTA',
  'EM_PROCESSO',
  'FINALIZADO',
  'CANCELADO',
] as const

export type ProcessStatus = (typeof processStatuses)[number]

export const defaultProcessStatus: ProcessStatus = 'EM_DOCUMENTACAO'

export const processHistoryEventTypes = [
  'CREATED',
  'UPDATED',
  'STATUS_CHANGED',
  'CANCELLED',
  'PDF_GENERATED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_REPLACED',
  'DOCUMENT_DELETED',
  'DOCUMENT_MARKED_OK_WITHOUT_FILE',
  'DOCUMENT_UNMARKED_OK_WITHOUT_FILE',
  'DOCUMENT_OBSERVATION_UPDATED',
] as const

export type ProcessHistoryEventType = (typeof processHistoryEventTypes)[number]

export const processDocumentStatuses = [
  'PENDENTE',
  'ANEXADO',
  'OK_SEM_ARQUIVO',
  'APROVADO',
  'REJEITADO',
] as const

export type ProcessDocumentStatus = (typeof processDocumentStatuses)[number]

const processStatusTransitions: Record<
  ProcessStatus,
  readonly ProcessStatus[]
> = {
  EM_DOCUMENTACAO: ['DOCUMENTACAO_PRONTA', 'CANCELADO'],
  DOCUMENTACAO_PRONTA: ['EM_PROCESSO', 'CANCELADO'],
  EM_PROCESSO: ['FINALIZADO', 'CANCELADO'],
  FINALIZADO: [],
  CANCELADO: [],
} satisfies Record<ProcessStatus, readonly ProcessStatus[]>

export function canTransitionProcessStatus(
  fromStatus: ProcessStatus,
  toStatus: ProcessStatus,
) {
  return processStatusTransitions[fromStatus].includes(toStatus)
}

export function isTerminalProcessStatus(status: ProcessStatus) {
  return status === 'FINALIZADO' || status === 'CANCELADO'
}
