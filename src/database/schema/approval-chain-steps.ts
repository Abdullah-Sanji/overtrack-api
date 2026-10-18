import { pgTable, uuid, text, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { teams, users, timestamps } from './users-teams';

export const approvalChainSteps = pgTable(
  'approval_chain_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    approverId: uuid('approver_id').notNull().references(() => users.id),
    backupApproverId: uuid('backup_approver_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex('chain_steps_team_position_idx').on(t.teamId, t.position)],
);
