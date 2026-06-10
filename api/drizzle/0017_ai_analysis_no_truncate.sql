-- Imutabilidade: alem de UPDATE/DELETE (0013), bloquear TRUNCATE — triggers de
-- linha (FOR EACH ROW) nao disparam em TRUNCATE, entao um TRUNCATE apagaria o
-- log de auditoria sem erro. A funcao prevent_ai_analysis_mutation so faz
-- RAISE EXCEPTION (nao referencia OLD/NEW), entao serve para statement-level.
CREATE TRIGGER "ai_analysis_no_truncate" BEFORE TRUNCATE ON "ai_analysis" FOR EACH STATEMENT EXECUTE FUNCTION "prevent_ai_analysis_mutation"();
