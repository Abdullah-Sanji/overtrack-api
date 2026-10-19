import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, lte, SQL } from 'drizzle-orm';
import { DrizzleService, DbOrTx } from '@/database/drizzle.service';
import { auditLog, users } from '@/database/schema';
import { paged, parsePagination } from '@/common/pagination';
import { ListAuditQueryDto } from './audit.dto';

export type AuditEntityType = 'sheet' | 'user' | 'team' | 'chain' | 'overtime_type';
export interface AuditEntry { actorId: string | null; action: string; entityType: AuditEntityType; entityId: string; before?: unknown; after?: unknown; reason?: string | null }

@Injectable()
export class AuditService {
  constructor(private readonly drizzle: DrizzleService) {}

  async record(db: DbOrTx, e: AuditEntry): Promise<void> {
    await db.insert(auditLog).values({ actorId: e.actorId, action: e.action, entityType: e.entityType, entityId: e.entityId, before: e.before ?? null, after: e.after ?? null, reason: e.reason ?? null });
  }

  private baseSelect() {
    return this.drizzle.db.select({
      id: auditLog.id, action: auditLog.action, entityType: auditLog.entityType, entityId: auditLog.entityId, before: auditLog.before, after: auditLog.after, reason: auditLog.reason, createdAt: auditLog.createdAt,
      actor: { id: users.id, firstName: users.firstName, lastName: users.lastName },
    }).from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId));
  }

  timelineForSheet(sheetId: string) {
    return this.baseSelect().where(and(eq(auditLog.entityType, 'sheet'), eq(auditLog.entityId, sheetId))).orderBy(asc(auditLog.createdAt));
  }

  async list(q: ListAuditQueryDto) {
    const p = parsePagination(q);
    const where: SQL[] = [];
    if (q.entityType) where.push(eq(auditLog.entityType, q.entityType));
    if (q.entityId) where.push(eq(auditLog.entityId, q.entityId));
    if (q.actorId) where.push(eq(auditLog.actorId, q.actorId));
    if (q.from) where.push(gte(auditLog.createdAt, new Date(q.from)));
    if (q.to) where.push(lte(auditLog.createdAt, new Date(q.to)));
    const cond = where.length ? and(...where) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      this.baseSelect().where(cond).orderBy(desc(auditLog.createdAt), desc(auditLog.id)).limit(p.limit).offset(p.offset),
      this.drizzle.db.select({ total: count() }).from(auditLog).where(cond),
    ]);
    return paged(rows.map((r) => ({ ...r, actor: r.actor?.id ? r.actor : null })), Number(total), p);
  }
}
