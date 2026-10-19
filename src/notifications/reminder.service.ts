import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { and, eq, exists, sql } from 'drizzle-orm';
import { formatInTimeZone } from 'date-fns-tz';
import { subMonths } from 'date-fns';
import { DrizzleService } from '@/database/drizzle.service';
import { notifications, settings, sheetEntries, sheets, users } from '@/database/schema';
import { Env } from '@/common/config/env';
import { genericEmail } from '@/mail/templates';
import { NotificationsService } from './notifications.service';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);
  constructor(private readonly drizzle: DrizzleService, private readonly notifications: NotificationsService, private readonly config: ConfigService<Env, true>) {}

  @Cron('0 * * * *')
  cron() { return this.runMonthlyReminder(new Date()).catch((e) => this.logger.error(`monthly reminder failed: ${(e as Error).message}`)); }

  async runMonthlyReminder(now: Date): Promise<void> {
    const [s] = await this.drizzle.db.select().from(settings);
    const tz = s?.defaultTimezone ?? this.config.get('DEFAULT_TIMEZONE');
    if (Number(formatInTimeZone(now, tz, 'H')) !== 8) return;
    const day = Number(formatInTimeZone(now, tz, 'd'));
    if (day !== (s?.reminderDayOfMonth ?? 1)) return;
    const prev = formatInTimeZone(subMonths(now, 1), tz, 'yyyy-MM');
    const rows = await this.drizzle.db.select({ id: users.id, firstName: users.firstName, sheetId: sheets.id }).from(sheets).innerJoin(users, eq(users.id, sheets.employeeId))
      .where(and(eq(sheets.status, 'draft'), eq(sheets.period, `${prev}-01`), eq(users.isActive, true), exists(this.drizzle.db.select({ one: sql`1` }).from(sheetEntries).where(eq(sheetEntries.sheetId, sheets.id)))));
    this.logger.log(`Monthly reminder: ${rows.length} draft sheet(s) for ${prev}`);
    for (const r of rows) {
      try {
        const link = `/sheets/${r.sheetId}`;
        const [done] = await this.drizzle.db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, r.id), eq(notifications.type, 'sheet.reminder'), eq(notifications.link, link))).limit(1);
        if (done) continue;
      await this.notifications.notify([r.id], { type: 'sheet.reminder', title: `Submit your ${prev} overtime sheet`, body: 'Your sheet from last month is still a draft.', link },
        genericEmail(`Submit your ${prev} overtime sheet`, `Hi ${r.firstName}, your ${prev} overtime sheet still has unsubmitted entries. Submit it so it can be approved and paid.`, { label: 'Open sheet', href: `${this.config.get('WEB_URL')}${link}` }));
      } catch (e) {
        this.logger.error(`reminder failed for user ${r.id}: ${(e as Error).message}`);
      }
    }
  }
}
