import { pgTable, uuid, integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sheets } from './sheets';
import { users } from './users-teams';
import { approvalStepStatusEnum } from './enums';

export const sheetApprovalSteps = pgTable(
  'sheet_approval_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sheetId: uuid('sheet_id').notNull().references(() => sheets.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    approverId: uuid('approver_id').notNull().references(() => users.id),
    backupApproverId: uuid('backup_approver_id').references(() => users.id),
    status: approvalStepStatusEnum('status').notNull().default('pending'),
    decidedById: uuid('decided_by_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    comment: text('comment'),
    overrideReason: text('override_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sheet_steps_sheet_round_position_idx').on(t.sheetId, t.round, t.position)],
);
