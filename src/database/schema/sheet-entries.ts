import { pgTable, uuid, date, time, numeric, text, index } from 'drizzle-orm/pg-core';
import { sheets } from './sheets';
import { overtimeTypes } from './overtime-types';
import { users, timestamps } from './users-teams';
import { attachments } from './attachments';

export const sheetEntries = pgTable(
  'sheet_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sheetId: uuid('sheet_id').notNull().references(() => sheets.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    hours: numeric('hours', { precision: 4, scale: 2 }).notNull(),
    overtimeTypeId: uuid('overtime_type_id').notNull().references(() => overtimeTypes.id),
    multiplierSnapshot: numeric('multiplier_snapshot', { precision: 4, scale: 2 }).notNull(),
    weightedHours: numeric('weighted_hours', { precision: 6, scale: 2 }).notNull(),
    workItem: text('work_item').notNull(),
    workItemUrl: text('work_item_url'),
    description: text('description').notNull(),
    requestedById: uuid('requested_by_id').references(() => users.id),
    attachmentId: uuid('attachment_id').references(() => attachments.id),
    ...timestamps,
  },
  (t) => [index('sheet_entries_sheet_idx').on(t.sheetId)],
);
