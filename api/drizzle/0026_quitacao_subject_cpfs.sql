-- v3: CPFs do(s) titular(es) do contrato Caixa (sujeitos da quitacao), derivados
-- pelo reconciliador. Lista separada por virgula (1-2 CPFs). O worker consulta
-- cada um ate o primeiro emitir. A fila de quitacao passa a nascer so quando isto
-- e conhecido; o worker nao usa mais process.cpf.
ALTER TABLE "process" ADD COLUMN "quitacao_subject_cpfs" text;
