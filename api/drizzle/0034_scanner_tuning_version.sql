-- Versao ativa do tuning de deteccao/recorte de borda do scanner. Mapeia para um
-- preset em web/.../scanner-tuning.ts (o web resolve os valores; versao
-- desconhecida ou NULL cai no default). Trocar o valor = rollback sem redeploy.
-- Nullable/sem default: linhas legadas ficam NULL e usam o default do web.
ALTER TABLE "app_settings" ADD COLUMN "scanner_tuning_version" text;
