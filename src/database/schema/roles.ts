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
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('roles_name_idx').on(sql`lower(${t.name})`)],
);

export const SYSTEM_ROLES: Array<{ name: string; level: RoleLevel }> = [
  { name: 'Employee', level: 'employee' },
  { name: 'Tech Lead', level: 'manager' },
  { name: 'Delivery Manager', level: 'manager' },
  { name: 'CTO', level: 'manager' },
  { name: 'Finance', level: 'finance' },
  { name: 'Admin', level: 'admin' },
];

/** Old enum value → system role name, used by the migration test and the test factories. */
export const LEGACY_ROLE_NAMES = {
  employee: 'Employee',
  tech_lead: 'Tech Lead',
  delivery_manager: 'Delivery Manager',
  cto: 'CTO',
  finance: 'Finance',
  admin: 'Admin',
} as const;
export type LegacyRole = keyof typeof LEGACY_ROLE_NAMES;
