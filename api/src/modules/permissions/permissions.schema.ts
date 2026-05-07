import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { user } from '../auth/auth.schema'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import type { ProfilePermissions } from './permissions.types'

export const processScopeEnum = pgEnum('process_scope', [
  'own',
  'housing_complex',
  'all',
])

export const permissionProfile = pgTable('permission_profile', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  processScope: processScopeEnum('process_scope').notNull().default('own'),
  permissions: jsonb('permissions').notNull().$type<ProfilePermissions>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

export const profileHousingComplex = pgTable(
  'profile_housing_complex',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => permissionProfile.id, { onDelete: 'cascade' }),
    housingComplexId: text('housing_complex_id')
      .notNull()
      .references(() => housingComplex.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.housingComplexId] }),
    index('phc_profile_id_idx').on(table.profileId),
    index('phc_housing_complex_id_idx').on(table.housingComplexId),
  ],
)

export const userProfile = pgTable(
  'user_profile',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    profileId: text('profile_id')
      .notNull()
      .references(() => permissionProfile.id, { onDelete: 'restrict' }),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
    assignedByUserId: text('assigned_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [index('user_profile_profile_id_idx').on(table.profileId)],
)

export const userHousingComplex = pgTable(
  'user_housing_complex',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    housingComplexId: text('housing_complex_id')
      .notNull()
      .references(() => housingComplex.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at').defaultNow().notNull(),
    grantedByUserId: text('granted_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.housingComplexId] }),
    index('uhc_user_id_idx').on(table.userId),
    index('uhc_housing_complex_id_idx').on(table.housingComplexId),
  ],
)

// Relations

export const permissionProfileRelations = relations(
  permissionProfile,
  ({ many }) => ({
    housingComplexes: many(profileHousingComplex),
    userProfiles: many(userProfile),
  }),
)

export const profileHousingComplexRelations = relations(
  profileHousingComplex,
  ({ one }) => ({
    profile: one(permissionProfile, {
      fields: [profileHousingComplex.profileId],
      references: [permissionProfile.id],
    }),
    housingComplex: one(housingComplex, {
      fields: [profileHousingComplex.housingComplexId],
      references: [housingComplex.id],
    }),
  }),
)

export const userProfileRelations = relations(userProfile, ({ one }) => ({
  user: one(user, {
    fields: [userProfile.userId],
    references: [user.id],
  }),
  profile: one(permissionProfile, {
    fields: [userProfile.profileId],
    references: [permissionProfile.id],
  }),
  assignedBy: one(user, {
    fields: [userProfile.assignedByUserId],
    references: [user.id],
    relationName: 'assignedByUser',
  }),
}))

export const userHousingComplexRelations = relations(
  userHousingComplex,
  ({ one }) => ({
    user: one(user, {
      fields: [userHousingComplex.userId],
      references: [user.id],
    }),
    housingComplex: one(housingComplex, {
      fields: [userHousingComplex.housingComplexId],
      references: [housingComplex.id],
    }),
    grantedBy: one(user, {
      fields: [userHousingComplex.grantedByUserId],
      references: [user.id],
      relationName: 'grantedByUser',
    }),
  }),
)
