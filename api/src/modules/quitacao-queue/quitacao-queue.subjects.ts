import type { QuitacaoJobSubjectType } from './quitacao-queue.schema'

// Registry que desacopla a FILA do DOMINIO: a fila despacha o desfecho ao handler
// do subject_type sem importar o modulo de dominio (evita ciclo fila<->titular e
// deixa a fila reusavel por outros subjects — ex.: processos, na migracao futura).
//
// Cada subject registra seu handler no import (efeito colateral). O modulo de
// dominio (ex.: titulares-caixa.subject) chama registerQuitacaoSubject('titular', ...).

export type QuitacaoProjection = {
  // Status TERMINAL a projetar na linha de negocio (o 'pending' fica por conta do
  // enqueue). null = ainda em retry, nao mexer na projecao.
  status: 'quitado' | 'nao_encontrado' | 'erro' | null
  message?: string
  checkedAt: Date
}

export type QuitacaoDocument = {
  bytes: Uint8Array
  filename: string
  contentType: string
}

export type QuitacaoSubjectHandler = {
  // Atualiza a projecao do status na linha de negocio do subject.
  projectResult: (
    subjectId: string,
    projection: QuitacaoProjection,
  ) => Promise<void>
  // Anexa o termo de quitacao ao subject. Idempotente: pode ser re-chamado num
  // retry. Lanca em falha (o chamador mantem o job re-tentavel — nao perde a quitacao).
  attachDocument: (
    subjectId: string,
    document: QuitacaoDocument,
  ) => Promise<void>
}

const handlers = new Map<QuitacaoJobSubjectType, QuitacaoSubjectHandler>()

export function registerQuitacaoSubject(
  subjectType: QuitacaoJobSubjectType,
  handler: QuitacaoSubjectHandler,
): void {
  handlers.set(subjectType, handler)
}

export function getQuitacaoSubject(
  subjectType: QuitacaoJobSubjectType,
): QuitacaoSubjectHandler {
  const handler = handlers.get(subjectType)
  if (!handler) {
    throw new Error(
      `Nenhum handler de quitacao registrado para o subject '${subjectType}'.`,
    )
  }
  return handler
}
