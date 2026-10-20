import { pgTable, pgEnum, uuid, text, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const ROLE_LEVELS = ['employee', 'manager', 'finance', 'admin'] as const;
export const roleLevelEnum = pgEnum('role_level', ROLE_LEVELS);
export type RoleLevel = (typeof ROLE_LEVELS)[number];

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    level: roleLevelEnum('level').notNull(),
    systemKey: text('system_key'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('roles_name_idx').on(sql`lower(${t.name})`), uniqueIndex('roles_system_key_idx').on(t.systemKey)],
);

/** Old enum value → system role display name; the keys are the stable `roles.system_key` values. */
export const LEGACY_ROLE_NAMES = {
  employee: 'Employee',
  tech_lead: 'Tech Lead',
  delivery_manager: 'Delivery Manager',
  cto: 'CTO',
  finance: 'Finance',
  admin: 'Admin',
} as const;
export type LegacyRole = keyof typeof LEGACY_ROLE_NAMES;
export type SystemRoleKey = LegacyRole;

const SYSTEM_LEVELS: Record<SystemRoleKey, RoleLevel> = { employee: 'employee', tech_lead: 'manager', delivery_manager: 'manager', cto: 'manager', finance: 'finance', admin: 'admin' };
export const SYSTEM_ROLES: Array<{ key: SystemRoleKey; name: string; level: RoleLevel }> = (Object.keys(LEGACY_ROLE_NAMES) as SystemRoleKey[]).map((key) => ({ key, name: LEGACY_ROLE_NAMES[key], level: SYSTEM_LEVELS[key] }));
