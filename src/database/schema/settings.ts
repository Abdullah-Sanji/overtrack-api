import { pgTable, integer, text, timestamp } from 'drizzle-orm/pg-core';

export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  companyName: text('company_name').notNull().default('OverTrack'),
  defaultTimezone: text('default_timezone').notNull().default('UTC'),
  reminderDayOfMonth: integer('reminder_day_of_month').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
