import { sql } from 'drizzle-orm';
import { Db } from '@/database/drizzle.service';

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE notifications, audit_log, refresh_tokens, password_tokens, sheet_approval_steps,
      sheet_entries, attachments, sheets, approval_chain_steps, overtime_types, users, teams, settings
    RESTART IDENTITY CASCADE
  `);
  await db.execute(sql`DELETE FROM roles WHERE NOT is_system`);
}
