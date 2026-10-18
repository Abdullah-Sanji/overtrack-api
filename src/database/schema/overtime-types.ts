import { pgTable, uuid, text, numeric, integer, boolean } from 'drizzle-orm/pg-core';
import { timestamps } from './users-teams';

export const overtimeTypes = pgTable('overtime_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  multiplier: numeric('multiplier', { precision: 4, scale: 2 }).notNull(),
  color: text('color').notNull().default('#2563EB'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});
