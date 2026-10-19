import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { notifications, users } from '@/database/schema';
import { Pagination } from '@/common/pagination';
import { MailService } from '@/mail/mail.service';

export interface NotificationInput { type: string; title: string; body: string; link: string | null }

@Injectable()
export class NotificationsService {
  constructor(private readonly drizzle: DrizzleService, private readonly mail: MailService) {}

  async notify(userIds: string[], n: NotificationInput, email?: { subject: string; html: string }): Promise<void> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    await this.drizzle.db.insert(notifications).values(ids.map((userId) => ({ userId, ...n })));
    if (email) {
      const rows = await this.drizzle.db.select({ email: users.email }).from(users).where(and(inArray(users.id, ids), eq(users.isActive, true)));
      await Promise.all(rows.map((r) => this.mail.send({ to: r.email, ...email })));
    }
  }

  async listFor(userId: string, unreadOnly: boolean, p: Pagination) {
    const cond = unreadOnly ? and(eq(notifications.userId, userId), isNull(notifications.readAt)) : eq(notifications.userId, userId);
    const [rows, [{ total }], unread] = await Promise.all([
      this.drizzle.db.select().from(notifications).where(cond).orderBy(desc(notifications.createdAt)).limit(p.limit).offset(p.offset),
      this.drizzle.db.select({ total: count() }).from(notifications).where(cond),
      this.unreadCount(userId),
    ]);
    return { data: rows, meta: { page: p.page, pageSize: p.pageSize, total: Number(total), unread } };
  }

  async unreadCount(userId: string): Promise<number> {
    const [{ n }] = await this.drizzle.db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return Number(n);
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.drizzle.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)));
  }

  async markAllRead(userId: string): Promise<void> {
    await this.drizzle.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }
}
