import { pgTable, uuid, date, integer, numeric, timestamp, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { users, timestamps } from './users-teams';
import { sheetStatusEnum } from './enums';

export const sheets = pgTable(
  'sheets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id').notNull().references(() => users.id),
    period: date('period').notNull(), // first day of month, YYYY-MM-01
    status: sheetStatusEnum('status').notNull().default('draft'),
    round: integer('round').notNull().default(1),
    currentStepPosition: integer('current_step_position'),
    totalHours: numeric('total_hours', { precision: 7, scale: 2 }).notNull().default('0'),
    totalWeightedHours: numeric('total_weighted_hours', { precision: 8, scale: 2 }).notNull().default('0'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paidById: uuid('paid_by_id').references(() => users.id),
    paymentReference: text('payment_reference'),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [uniqueIndex('sheets_employee_period_idx').on(t.employeeId, t.period), index('sheets_status_idx').on(t.status)],
);
