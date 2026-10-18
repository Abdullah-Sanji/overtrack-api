import { pgTable, uuid, text, boolean, timestamp, uniqueIndex, AnyPgColumn } from 'drizzle-orm/pg-core';
import { userRoleEnum } from './enums';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  techLeadId: uuid('tech_lead_id').references((): AnyPgColumn => users.id),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeCode: text('employee_code'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    role: userRoleEnum('role').notNull().default('employee'),
    teamId: uuid('team_id').references(() => teams.id),
    timezone: text('timezone').notNull().default('UTC'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email), uniqueIndex('users_employee_code_idx').on(t.employeeCode)],
);

export { timestamps };
