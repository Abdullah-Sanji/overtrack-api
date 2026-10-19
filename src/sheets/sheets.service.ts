import { Injectable } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, count, desc, eq, exists, inArray, or, SQL, sum } from 'drizzle-orm';
import { DrizzleService, DbOrTx, Tx } from '@/database/drizzle.service';
import { attachments, overtimeTypes, sheetApprovalSteps, sheetEntries, sheets, teams, users } from '@/database/schema';
import { AuthUser } from '@/common/auth/auth-user';
import { forbidden, notFound } from '@/common/errors/domain-error';
import { paged, parsePagination } from '@/common/pagination';
import { dateToPeriod, periodToDate } from '@/common/zod';
import { ListSheetsQueryDto } from './sheets.dto';
import { VisibilityService } from './visibility.service';

export type SheetRow = typeof sheets.$inferSelect;

export interface SheetSummary {
  id: string; period: string; status: SheetRow['status']; round: number; currentStepPosition: number | null; totalHours: number; totalWeightedHours: number;
  submittedAt: Date | null; approvedAt: Date | null; rejectedAt: Date | null; rejectionReason: string | null; paidAt: Date | null; paymentReference: string | null; version: number;
  employee: { id: string; firstName: string; lastName: string; employeeCode: string | null; teamId: string | null; teamName: string | null };
}

@Injectable()
export class SheetsService {
  constructor(private readonly drizzle: DrizzleService, private readonly visibility: VisibilityService) {}

  private summarySelect(db: DbOrTx) {
    return db.select({
      sheet: sheets,
      employee: { id: users.id, firstName: users.firstName, lastName: users.lastName, employeeCode: users.employeeCode, teamId: users.teamId, teamName: teams.name },
    }).from(sheets).innerJoin(users, eq(users.id, sheets.employeeId)).leftJoin(teams, eq(teams.id, users.teamId));
  }

  static toSummary(r: { sheet: SheetRow; employee: SheetSummary['employee'] }): SheetSummary {
    const s = r.sheet;
    return {
      id: s.id, period: dateToPeriod(s.period), status: s.status, round: s.round, currentStepPosition: s.currentStepPosition,
      totalHours: Number(s.totalHours), totalWeightedHours: Number(s.totalWeightedHours), submittedAt: s.submittedAt, approvedAt: s.approvedAt,
      rejectedAt: s.rejectedAt, rejectionReason: s.rejectionReason, paidAt: s.paidAt, paymentReference: s.paymentReference, version: s.version, employee: r.employee,
    };
  }

  async getOrCreateForPeriod(employeeId: string, period: string): Promise<SheetSummary> {
    const db = this.drizzle.db;
    await db.insert(sheets).values({ employeeId, period: periodToDate(period) }).onConflictDoNothing();
    const [r] = await this.summarySelect(db).where(and(eq(sheets.employeeId, employeeId), eq(sheets.period, periodToDate(period))));
    return SheetsService.toSummary(r);
  }

  async findRaw(id: string, db: DbOrTx = this.drizzle.db) {
    const [r] = await this.summarySelect(db).where(eq(sheets.id, id));
    if (!r) throw notFound('Sheet');
    return r;
  }

  async lockForUpdate(tx: Tx, id: string): Promise<SheetRow> {
    const [row] = await tx.select().from(sheets).where(eq(sheets.id, id)).for('update');
    if (!row) throw notFound('Sheet');
    return row;
  }

  async assertCanView(actor: AuthUser, id: string) {
    const r = await this.findRaw(id);
    if (!(await this.visibility.canViewSheet(actor, { id: r.sheet.id, employeeId: r.sheet.employeeId, teamId: r.employee.teamId }))) throw forbidden('You cannot view this sheet');
    return r;
  }

  async findDetail(id: string, actor: AuthUser) {
    const r = await this.assertCanView(actor, id);
    const [entries, steps] = await Promise.all([this.entriesOf(id), this.stepsOf(id, r.sheet.round)]);
    return { ...SheetsService.toSummary(r), entries, steps };
  }

  async entriesOf(sheetId: string, db: DbOrTx = this.drizzle.db) {
    const requester = alias(users, 'requester');
    const rows = await db.select({
      e: sheetEntries, type: { id: overtimeTypes.id, name: overtimeTypes.name, color: overtimeTypes.color },
      requestedBy: { id: requester.id, firstName: requester.firstName, lastName: requester.lastName },
      attachment: { id: attachments.id, originalName: attachments.originalName, mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes },
    }).from(sheetEntries)
      .innerJoin(overtimeTypes, eq(overtimeTypes.id, sheetEntries.overtimeTypeId))
      .leftJoin(requester, eq(requester.id, sheetEntries.requestedById))
      .leftJoin(attachments, eq(attachments.id, sheetEntries.attachmentId))
      .where(eq(sheetEntries.sheetId, sheetId)).orderBy(asc(sheetEntries.date), asc(sheetEntries.startTime));
    return rows.map(SheetsService.toEntryView);
  }

  static toEntryView(r: { e: typeof sheetEntries.$inferSelect; type: { id: string; name: string; color: string }; requestedBy: { id: string | null; firstName: string | null; lastName: string | null } | null; attachment: { id: string | null; originalName: string | null; mimeType: string | null; sizeBytes: number | null } | null }) {
    const { e } = r;
    return {
      id: e.id, date: e.date, startTime: e.startTime.slice(0, 5), endTime: e.endTime.slice(0, 5), hours: Number(e.hours), multiplier: Number(e.multiplierSnapshot), weightedHours: Number(e.weightedHours),
      overtimeType: r.type, workItem: e.workItem, workItemUrl: e.workItemUrl, description: e.description,
      requestedBy: r.requestedBy?.id ? (r.requestedBy as { id: string; firstName: string; lastName: string }) : null,
      attachment: r.attachment?.id ? (r.attachment as { id: string; originalName: string; mimeType: string; sizeBytes: number }) : null,
    };
  }

  async stepsOf(sheetId: string, round: number, db: DbOrTx = this.drizzle.db) {
    const approver = alias(users, 'approver'); const backup = alias(users, 'backup'); const decider = alias(users, 'decider');
    const rows = await db.select({
      s: sheetApprovalSteps,
      approver: { id: approver.id, firstName: approver.firstName, lastName: approver.lastName },
      backup: { id: backup.id, firstName: backup.firstName, lastName: backup.lastName },
      decidedBy: { id: decider.id, firstName: decider.firstName, lastName: decider.lastName },
    }).from(sheetApprovalSteps)
      .innerJoin(approver, eq(approver.id, sheetApprovalSteps.approverId))
      .leftJoin(backup, eq(backup.id, sheetApprovalSteps.backupApproverId))
      .leftJoin(decider, eq(decider.id, sheetApprovalSteps.decidedById))
      .where(and(eq(sheetApprovalSteps.sheetId, sheetId), eq(sheetApprovalSteps.round, round))).orderBy(asc(sheetApprovalSteps.position));
    return rows.map((r) => ({
      position: r.s.position, label: r.s.label, status: r.s.status, round: r.s.round, approver: r.approver,
      backupApprover: r.backup?.id ? r.backup : null, decidedBy: r.decidedBy?.id ? r.decidedBy : null, decidedAt: r.s.decidedAt, comment: r.s.comment, overrideReason: r.s.overrideReason,
    }));
  }

  async list(q: ListSheetsQueryDto, actor: AuthUser) {
    const p = parsePagination(q);
    const where: SQL[] = [];
    const visible = await this.visibility.visibleTeamIds(actor);
    if (visible === 'all') {
      if (q.employeeId) where.push(eq(sheets.employeeId, q.employeeId));
    } else {
      const own = eq(sheets.employeeId, actor.id);
      const named = exists(this.drizzle.db.select({ one: sheetApprovalSteps.id }).from(sheetApprovalSteps)
        .where(and(eq(sheetApprovalSteps.sheetId, sheets.id), or(eq(sheetApprovalSteps.approverId, actor.id), eq(sheetApprovalSteps.backupApproverId, actor.id)))));
      const seen = visible.length > 0 ? or(inArray(users.teamId, visible), named)! : named;
      if (q.employeeId && q.employeeId !== actor.id) where.push(and(eq(sheets.employeeId, q.employeeId), seen)!);
      else if (!q.employeeId) where.push(or(own, seen)!);
      else where.push(own);
    }
    if (q.teamId) where.push(eq(users.teamId, q.teamId));
    if (q.period) where.push(eq(sheets.period, periodToDate(q.period)));
    if (q.status) where.push(eq(sheets.status, q.status));
    const cond = where.length ? and(...where) : undefined;
    const base = this.drizzle.db.select({ total: count() }).from(sheets).innerJoin(users, eq(users.id, sheets.employeeId)).where(cond);
    const [rows, [{ total }]] = await Promise.all([
      this.summarySelect(this.drizzle.db).where(cond).orderBy(desc(sheets.period), asc(users.lastName)).limit(p.limit).offset(p.offset), base,
    ]);
    return paged(rows.map(SheetsService.toSummary), Number(total), p);
  }

  async recomputeTotals(tx: DbOrTx, sheetId: string): Promise<void> {
    const [t] = await tx.select({ h: sum(sheetEntries.hours), w: sum(sheetEntries.weightedHours) }).from(sheetEntries).where(eq(sheetEntries.sheetId, sheetId));
    await tx.update(sheets).set({ totalHours: t.h ?? '0', totalWeightedHours: t.w ?? '0', updatedAt: new Date() }).where(eq(sheets.id, sheetId));
  }
}
