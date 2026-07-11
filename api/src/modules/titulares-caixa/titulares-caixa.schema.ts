import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { user } from '../auth/auth.schema'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'

// Cadastro de titular de contrato Caixa (uma linha por titular/contrato, importado
// da planilha "lista_titular_contrato_caixa"). Dado de NEGOCIO — a mecanica da
// consulta de quitacao vive na fila (quitacao_job); aqui guardamos apenas uma
// PROJECAO do status para listar/filtrar rapido.

// idle: sem consulta | pending: enfileirada/em andamento | terminais: quitado /
// nao_encontrado / erro (job dead-letter).
export const titularQuitacaoStatuses = [
  'idle',
  'pending',
  'quitado',
  'nao_encontrado',
  'erro',
] as const
export type TitularQuitacaoStatus = (typeof titularQuitacaoStatuses)[number]

export const titularQuitacaoStatusEnum = pgEnum(
  'titular_quitacao_status',
  titularQuitacaoStatuses,
)

// Flag "Averbacao" lido do termo de quitacao (frase "procedimento de averbacao").
// null = ainda nao analisado; indeterminado = PDF ilegivel/template desconhecido.
export const titularAverbacaoValues = ['sim', 'nao', 'indeterminado'] as const
export type TitularAverbacao = (typeof titularAverbacaoValues)[number]

export const titularAverbacaoEnum = pgEnum(
  'titular_averbacao',
  titularAverbacaoValues,
)

export const titularContratoCaixa = pgTable(
  'titular_contrato_caixa',
  {
    id: text('id').primaryKey(),
    // Colunas da planilha.
    uf: text('uf').notNull(),
    municipio: text('municipio').notNull(),
    modalidade: text('modalidade').notNull(),
    empreendimento: text('empreendimento').notNull(),
    mutuarioNome: text('mutuario_nome').notNull(),
    cpf: text('cpf').notNull(), // normalizado (11 digitos)
    pis: text('pis'),
    dataAssinatura: date('data_assinatura'),
    logradouro: text('logradouro'),
    numeroImovel: text('numero_imovel'),
    // Parte da identidade natural (indice unico) — nao pode ser NULL (o Postgres
    // trata NULLs como distintos e o upsert do reimport duplicaria a linha). Vazio
    // vira '' para a identidade ser deterministica.
    complemento: text('complemento').default('').notNull(),
    bairro: text('bairro'),
    // Projecao do status da quitacao (dirigida pela fila).
    quitacaoStatus: titularQuitacaoStatusEnum('quitacao_status')
      .default('idle')
      .notNull(),
    quitacaoMessage: text('quitacao_message'),
    quitacaoLastCheckedAt: timestamp('quitacao_last_checked_at'),
    // Flag "Averbacao" derivado do termo (null = ainda nao analisado).
    averbacao: titularAverbacaoEnum('averbacao'),
    averbacaoCheckedAt: timestamp('averbacao_checked_at'),
    // Conjunto habitacional (housing_complex) resolvido pelo `empreendimento` na
    // importacao. null = empreendimento sem conjunto cadastrado (fica visivel so
    // para admin/all-scope). E o ancoradouro da permissao por conjunto: o recorte
    // de visibilidade dos titulares usa este FK (ver titulares-caixa.access.ts).
    housingComplexId: text('housing_complex_id').references(
      () => housingComplex.id,
      { onDelete: 'set null' },
    ),
    // Auditoria.
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    importBatchId: text('import_batch_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('titular_cpf_idx').on(table.cpf),
    index('titular_quitacao_status_idx').on(table.quitacaoStatus),
    index('titular_averbacao_idx').on(table.averbacao),
    index('titular_empreendimento_idx').on(table.empreendimento),
    index('titular_housing_complex_idx').on(table.housingComplexId),
    index('titular_uf_idx').on(table.uf),
    index('titular_municipio_idx').on(table.municipio),
    // Identidade natural: o upsert do reimport atualiza os descritivos SEM duplicar
    // a linha nem perder a quitacao ja resolvida. Um titular pode ter varios
    // contratos (empreendimentos/unidades), entao CPF sozinho nao e unico.
    uniqueIndex('titular_natural_idx').on(
      table.cpf,
      table.empreendimento,
      table.complemento,
    ),
  ],
)

export const titularDocumentoTipos = ['termo_quitacao'] as const
export type TitularDocumentoTipo = (typeof titularDocumentoTipos)[number]

export const titularDocumentoTipoEnum = pgEnum(
  'titular_documento_tipo',
  titularDocumentoTipos,
)

export const titularDocumentoSources = ['rpa', 'manual'] as const
export const titularDocumentoSourceEnum = pgEnum(
  'titular_documento_source',
  titularDocumentoSources,
)

// Documento vinculado ao titular (termo/declaracao de quitacao). Bytes no storage
// (MinIO/S3); metadados aqui. NAO reusa o checklist do processo (abstracao errada:
// titular nao tem processo/checklist).
export const titularDocumento = pgTable(
  'titular_documento',
  {
    id: text('id').primaryKey(),
    titularId: text('titular_id')
      .notNull()
      .references(() => titularContratoCaixa.id, { onDelete: 'cascade' }),
    tipo: titularDocumentoTipoEnum('tipo').notNull(),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    source: titularDocumentoSourceEnum('source').default('rpa').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('titular_documento_titular_idx').on(table.titularId),
    // No maximo um documento por tipo por titular: o reanexo (retry idempotente ou
    // reconsulta) faz upsert em vez de acumular duplicatas.
    uniqueIndex('titular_documento_titular_tipo_idx').on(
      table.titularId,
      table.tipo,
    ),
  ],
)

// Terceiro vinculado ao titular (exatamente UM por titular — upsert por
// titular_id). Contato de pessoa relacionada ao contrato (ex.: quem ocupa o
// imovel ou intermedia a regularizacao).
export const titularTerceiro = pgTable(
  'titular_terceiro',
  {
    id: text('id').primaryKey(),
    titularId: text('titular_id')
      .notNull()
      .references(() => titularContratoCaixa.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    // 1..N telefones, formato livre como digitado (mesma convencao do whatsapp
    // do processo — sem normalizacao de digitos).
    telefones: jsonb('telefones').notNull().$type<string[]>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Unico por titular (alvo do onConflictDoUpdate) e tambem o indice do FK.
    uniqueIndex('titular_terceiro_titular_idx').on(table.titularId),
  ],
)

export type TitularContratoCaixaRow = typeof titularContratoCaixa.$inferSelect
export type TitularDocumentoRow = typeof titularDocumento.$inferSelect
export type TitularTerceiroRow = typeof titularTerceiro.$inferSelect
