import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Configuracoes do sistema (linha unica, id fixo 'default').
export const appSettings = pgTable('app_settings', {
  id: text('id').primaryKey(),
  anthropicApiKey: text('anthropic_api_key'),
  scanbotLicenseKey: text('scanbot_license_key'),
  // Servico de digitalizacao escolhido no painel:
  // 'scanbot' | 'docaligner' | 'scan-hd' ('web' e legado -> docaligner).
  scannerProvider: text('scanner_provider'),
  // Versao ativa do tuning de deteccao/recorte de borda (margem, fallback,
  // revisao). Mapeia para um preset em web/.../scanner-tuning.ts — o web resolve
  // os valores; versao desconhecida cai no default. Trocar aqui = rollback sem
  // redeploy. NULL -> default do web.
  scannerTuningVersion: text('scanner_tuning_version'),
  // Liga a auto-aplicacao do ownerType pela analise do contrato Caixa. Default
  // false (modo shadow): a analise registra evidencia mas NAO altera o processo.
  caixaOwnerAutoApply: boolean('caixa_owner_auto_apply')
    .default(false)
    .notNull(),
  // Liga a auto-aplicacao do conjunto (housingComplex) pela analise da procuracao.
  // Default false (shadow): registra evidencia mas NAO altera o processo.
  procuracaoConjuntoAutoApply: boolean('procuracao_conjunto_auto_apply')
    .default(false)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})
