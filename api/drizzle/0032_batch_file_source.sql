-- Scan HD: origem ESTRUTURAL do arquivo de lote ('scan' = foto da camera,
-- elegivel ao realce server-side | 'import' = PDF enviado, rasterizar
-- degradaria). O gate do realce usa esta coluna — nunca o originalFileName,
-- que no import vem livre do usuario (um import chamado 'scan.pdf' casaria).
-- Default 'import' cobre linhas legadas: a coluna so importa DURANTE a
-- ingestao, ja concluida para elas — sem backfill.
ALTER TABLE "process_batch_file" ADD COLUMN "source" text DEFAULT 'import' NOT NULL;
