import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Configuracoes do sistema (linha unica, id fixo 'default').
export const appSettings = pgTable('app_settings', {
  id: text('id').primaryKey(),
  anthropicApiKey: text('anthropic_api_key'),
  scanbotLicenseKey: text('scanbot_license_key'),
  // Servico de digitalizacao escolhido no painel: 'scanbot' | 'web'.
  scannerProvider: text('scanner_provider'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})
