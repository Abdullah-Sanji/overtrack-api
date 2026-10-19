import { Injectable } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import { DrizzleService, DbOrTx } from '@/database/drizzle.service';
import { overtimeTypes } from '@/database/schema';
import { notFound } from '@/common/errors/domain-error';
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
  constructor(private readonly drizzle: DrizzleService) {}

  async list(includeInactive = false): Promise<OvertimeType[]> {
    const rows = await this.drizzle.db.select().from(overtimeTypes).where(includeInactive ? undefined : eq(overtimeTypes.isActive, true)).orderBy(asc(overtimeTypes.sortOrder), asc(overtimeTypes.name));
    return rows.map(toType);
  }

  async findActiveById(id: string, db: DbOrTx = this.drizzle.db): Promise<OvertimeType> {
    const [r] = await db.select().from(overtimeTypes).where(and(eq(overtimeTypes.id, id), eq(overtimeTypes.isActive, true)));
    if (!r) throw notFound('Overtime type');
    return toType(r);
  }

  async create(dto: CreateOvertimeTypeDto): Promise<OvertimeType> {
    const [r] = await this.drizzle.db.insert(overtimeTypes).values({ ...dto, multiplier: dto.multiplier.toFixed(2) }).returning();
    return toType(r);
  }

  async update(id: string, dto: UpdateOvertimeTypeDto): Promise<OvertimeType> {
    const { multiplier, ...rest } = dto;
    const [r] = await this.drizzle.db.update(overtimeTypes).set({ ...rest, ...(multiplier !== undefined ? { multiplier: multiplier.toFixed(2) } : {}), updatedAt: new Date() }).where(eq(overtimeTypes.id, id)).returning();
    if (!r) throw notFound('Overtime type');
    return toType(r);
  }

  async ensureDefaults(): Promise<void> {
    const [{ n }] = await this.drizzle.db.select({ n: count() }).from(overtimeTypes);
    if (Number(n) === 0) await this.drizzle.db.insert(overtimeTypes).values(DEFAULT_OVERTIME_TYPES);
  }
}
