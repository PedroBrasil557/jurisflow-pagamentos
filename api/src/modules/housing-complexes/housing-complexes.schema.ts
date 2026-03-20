import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const housingComplex = pgTable(
  'housing_complex',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex('housing_complex_name_idx').on(table.name)],
)
