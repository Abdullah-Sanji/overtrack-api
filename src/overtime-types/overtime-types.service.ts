import { Injectable } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import { DrizzleService, DbOrTx } from '@/database/drizzle.service';
import { overtimeTypes } from '@/database/schema';
import { AuditService } from '@/audit/audit.service';
import { DomainError, notFound } from '@/common/errors/domain-error';
import { uniqueViolationConstraint } from '@/common/errors/pg';
import { CreateOvertimeTypeDto, UpdateOvertimeTypeDto } from './overtime-types.dto';

export interface OvertimeType { id: string; name: string; multiplier: number; color: string; sortOrder: number; isActive: boolean }
const toType = (r: typeof overtimeTypes.$inferSelect): OvertimeType => ({ id: r.id, name: r.name, multiplier: Number(r.multiplier), color: r.color, sortOrder: r.sortOrder, isActive: r.isActive });

export const DEFAULT_OVERTIME_TYPES = [
  { name: 'Weekday extra hours', multiplier: '1.50', color: '#2563EB', sortOrder: 1 },
  { name: 'Weekend', multiplier: '2.00', color: '#7C3AED', sortOrder: 2 },
  { name: 'Public holiday', multiplier: '2.50', color: '#DB2777', sortOrder: 3 },
  { name: 'On-call / standby', multiplier: '1.00', color: '#059669', sortOrder: 4 },
];

@Injectable()
export class OvertimeTypesService {
  constructor(private readonly drizzle: DrizzleService, private readonly audit: AuditService) {}

  async list(includeInactive = false): Promise<OvertimeType[]> {
    const rows = await this.drizzle.db.select().from(overtimeTypes).where(includeInactive ? undefined : eq(overtimeTypes.isActive, true)).orderBy(asc(overtimeTypes.sortOrder), asc(overtimeTypes.name));
    return rows.map(toType);
  }

  async findActiveById(id: string, db: DbOrTx = this.drizzle.db): Promise<OvertimeType> {
    const [r] = await db.select().from(overtimeTypes).where(and(eq(overtimeTypes.id, id), eq(overtimeTypes.isActive, true)));
    if (!r) throw notFound('Overtime type');
    return toType(r);
  }

  async create(actorId: string, dto: CreateOvertimeTypeDto): Promise<OvertimeType> {
    try {
      return await this.drizzle.db.transaction(async (tx) => {
        const [r] = await tx.insert(overtimeTypes).values({ ...dto, multiplier: dto.multiplier.toFixed(2) }).returning();
        const after = toType(r);
        await this.audit.record(tx, { actorId, action: 'overtime_type.created', entityType: 'overtime_type', entityId: r.id, after });
        return after;
      });
    } catch (err) {
      throw this.mapDbError(err);
    }
  }

  async update(actorId: string, id: string, dto: UpdateOvertimeTypeDto): Promise<OvertimeType> {
    const { multiplier, ...rest } = dto;
    try {
      return await this.drizzle.db.transaction(async (tx) => {
        const [prev] = await tx.select().from(overtimeTypes).where(eq(overtimeTypes.id, id));
        if (!prev) throw notFound('Overtime type');
        const [r] = await tx.update(overtimeTypes).set({ ...rest, ...(multiplier !== undefined ? { multiplier: multiplier.toFixed(2) } : {}), updatedAt: new Date() }).where(eq(overtimeTypes.id, id)).returning();
        const after = toType(r);
        await this.audit.record(tx, { actorId, action: 'overtime_type.updated', entityType: 'overtime_type', entityId: id, before: toType(prev), after });
        return after;
      });
    } catch (err) {
      throw this.mapDbError(err);
    }
  }

  private mapDbError(err: unknown): unknown {
    if (uniqueViolationConstraint(err) === 'overtime_types_name_unique') return new DomainError('CONFLICT', 'Overtime type name already exists', 409);
    return err;
  }

  async ensureDefaults(): Promise<void> {
    const [{ n }] = await this.drizzle.db.select({ n: count() }).from(overtimeTypes);
    if (Number(n) === 0) await this.drizzle.db.insert(overtimeTypes).values(DEFAULT_OVERTIME_TYPES);
  }
}
