-- v3: estado de consulta da quitacao POR CPF (jsonb) substitui a lista em texto.
-- Separa identidade (quem consultar, derivado) de workflow (consulta por CPF), com
-- status terminal por entrada — o reconciliador faz set-diff preservando terminais.
ALTER TABLE "process" DROP COLUMN IF EXISTS "quitacao_subject_cpfs";
--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN "quitacao_consultas" jsonb DEFAULT '[]'::jsonb NOT NULL;
