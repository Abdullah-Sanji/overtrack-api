import { Injectable } from '@nestjs/common';
import { and, eq, gte, lte, ne } from 'drizzle-orm';
import { formatInTimeZone } from 'date-fns-tz';
import { addDays as addDaysToDate, format } from 'date-fns';
import { DrizzleService, DbOrTx, Tx } from '@/database/drizzle.service';
import { sheetEntries, users } from '@/database/schema';
import { AuthUser } from '@/common/auth/auth-user';
import { DomainError, forbidden, notFound } from '@/common/errors/domain-error';
import { OvertimeTypesService } from '@/overtime-types/overtime-types.service';
import { SheetsService } from './sheets.service';
import { CreateEntryDto, UpdateEntryDto } from './sheets.dto';
import { entryInterval, hoursBetween, intervalsOverlap, isQuarterStep, weighted } from './hours';

const EDITABLE = new Set(['draft', 'rejected']);
const addDays = (date: string, n: number) => format(addDaysToDate(new Date(`${date}T00:00:00`), n), 'yyyy-MM-dd');

@Injectable()
export class EntriesService {
  constructor(private readonly drizzle: DrizzleService, private readonly sheets: SheetsService, private readonly types: OvertimeTypesService) {}

  private assertHoursRange(hours: number, start: string, end: string) {
    const fail = (msg: string) => new DomainError('VALIDATION_FAILED', msg, 400, [{ path: 'hours', message: msg }]);
    if (hours < 0.25 || hours > 16 || !isQuarterStep(hours)) throw fail('Hours must be between 0.25 and 16 in 0.25 steps');
    // hours drive pay, so a claimed figure can be less than the span (breaks) but never more
    if (hours > hoursBetween(start, end)) throw fail('Hours cannot exceed the time between start and end');
  }

  private async editableSheet(tx: Tx, actor: AuthUser, sheetId: string) {
    await this.sheets.lockForUpdate(tx, sheetId);
    const r = await this.sheets.findRaw(sheetId, tx);
    if (r.sheet.employeeId !== actor.id) throw forbidden('Only the sheet owner can edit entries');
    if (!EDITABLE.has(r.sheet.status)) throw new DomainError('SHEET_NOT_EDITABLE', `Sheet is ${r.sheet.status} and cannot be edited`, 409);
    return r;
  }

  private async validateDate(tx: DbOrTx, employeeId: string, period: string, date: string) {
    if (!date.startsWith(period.slice(0, 7))) throw new DomainError('ENTRY_OUT_OF_PERIOD', 'Date is outside the sheet period', 400);
    const [u] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, employeeId));
    const today = formatInTimeZone(new Date(), u?.tz ?? 'UTC', 'yyyy-MM-dd');
    if (date > today) throw new DomainError('ENTRY_IN_FUTURE', 'Date cannot be in the future', 400);
  }

  /** Entries may cross midnight, so compare absolute intervals against the neighbouring dates of this sheet rather than same-date times. */
  private async assertNoOverlap(tx: DbOrTx, sheetId: string, date: string, start: string, end: string, excludeId?: string) {
    const mine = entryInterval(date, start, end);
    const conds = [eq(sheetEntries.sheetId, sheetId), gte(sheetEntries.date, addDays(date, -1)), lte(sheetEntries.date, addDays(date, 1))];
    if (excludeId) conds.push(ne(sheetEntries.id, excludeId));
    const rows = await tx.select({ date: sheetEntries.date, startTime: sheetEntries.startTime, endTime: sheetEntries.endTime }).from(sheetEntries).where(and(...conds));
    if (rows.some((r) => intervalsOverlap(mine, entryInterval(r.date, r.startTime.slice(0, 5), r.endTime.slice(0, 5))))) {
      throw new DomainError('ENTRY_OVERLAP', 'Overlaps an existing entry', 409);
    }
  }

  async create(actor: AuthUser, sheetId: string, dto: CreateEntryDto) {
    return this.drizzle.db.transaction(async (tx) => {
      const { sheet } = await this.editableSheet(tx, actor, sheetId);
      await this.validateDate(tx, sheet.employeeId, sheet.period, dto.date);
      await this.assertNoOverlap(tx, sheetId, dto.date, dto.startTime, dto.endTime);
      const type = await this.types.findActiveById(dto.overtimeTypeId, tx);
      const hours = dto.hours ?? hoursBetween(dto.startTime, dto.endTime);
      this.assertHoursRange(hours, dto.startTime, dto.endTime);
      const [row] = await tx.insert(sheetEntries).values({
        sheetId, date: dto.date, startTime: dto.startTime, endTime: dto.endTime, hours: hours.toFixed(2), overtimeTypeId: type.id,
        multiplierSnapshot: type.multiplier.toFixed(2), weightedHours: weighted(hours, type.multiplier).toFixed(2),
        workItem: dto.workItem, workItemUrl: dto.workItemUrl ?? null, description: dto.description, requestedById: dto.requestedById ?? null,
      }).returning({ id: sheetEntries.id });
      await this.sheets.recomputeTotals(tx, sheetId);
      const [view] = (await this.sheets.entriesOf(sheetId, tx)).filter((e) => e.id === row.id);
      return view;
    });
  }

  async update(actor: AuthUser, sheetId: string, entryId: string, dto: UpdateEntryDto) {
    return this.drizzle.db.transaction(async (tx) => {
      const { sheet } = await this.editableSheet(tx, actor, sheetId);
      const [cur] = await tx.select().from(sheetEntries).where(and(eq(sheetEntries.id, entryId), eq(sheetEntries.sheetId, sheetId)));
      if (!cur) throw notFound('Entry');
      const date = dto.date ?? cur.date; const start = dto.startTime ?? cur.startTime.slice(0, 5); const end = dto.endTime ?? cur.endTime.slice(0, 5);
      if (hoursBetween(start, end) <= 0) throw new DomainError('VALIDATION_FAILED', 'End time must differ from start time', 400, [{ path: 'endTime', message: 'End time must differ from start time' }]);
      await this.validateDate(tx, sheet.employeeId, sheet.period, date);
      await this.assertNoOverlap(tx, sheetId, date, start, end, entryId);
      const type = dto.overtimeTypeId ? await this.types.findActiveById(dto.overtimeTypeId, tx) : { id: cur.overtimeTypeId, multiplier: Number(cur.multiplierSnapshot) };
      const timesChanged = dto.startTime !== undefined || dto.endTime !== undefined;
      const hours = dto.hours ?? (timesChanged ? hoursBetween(start, end) : Number(cur.hours));
      this.assertHoursRange(hours, start, end);
      await tx.update(sheetEntries).set({
        date, startTime: start, endTime: end, hours: hours.toFixed(2), overtimeTypeId: type.id, multiplierSnapshot: type.multiplier.toFixed(2),
        weightedHours: weighted(hours, type.multiplier).toFixed(2),
        workItem: dto.workItem ?? cur.workItem, workItemUrl: dto.workItemUrl === undefined ? cur.workItemUrl : dto.workItemUrl,
        description: dto.description ?? cur.description, requestedById: dto.requestedById === undefined ? cur.requestedById : dto.requestedById, updatedAt: new Date(),
      }).where(eq(sheetEntries.id, entryId));
      await this.sheets.recomputeTotals(tx, sheetId);
      return (await this.sheets.entriesOf(sheetId, tx)).find((e) => e.id === entryId)!;
    });
  }

  async remove(actor: AuthUser, sheetId: string, entryId: string): Promise<void> {
    await this.drizzle.db.transaction(async (tx) => {
      await this.editableSheet(tx, actor, sheetId);
      const deleted = await tx.delete(sheetEntries).where(and(eq(sheetEntries.id, entryId), eq(sheetEntries.sheetId, sheetId))).returning({ id: sheetEntries.id });
      if (deleted.length === 0) throw notFound('Entry');
      await this.sheets.recomputeTotals(tx, sheetId);
    });
  }
}
