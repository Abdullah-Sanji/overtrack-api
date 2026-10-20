import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, or, SQL } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { sheetApprovalSteps, sheets, teams, users } from '@/database/schema';
import { AuthUser } from '@/common/auth/auth-user';
import { paged, Pagination } from '@/common/pagination';
import { SheetsService } from '@/sheets/sheets.service';

export type InboxScope = 'waiting' | 'upcoming' | 'decided';

@Injectable()
export class InboxService {
  constructor(private readonly drizzle: DrizzleService) {}

  async list(actor: AuthUser, scope: InboxScope, p: Pagination) {
    const db = this.drizzle.db;
    const mine = or(eq(sheetApprovalSteps.approverId, actor.id), eq(sheetApprovalSteps.backupApproverId, actor.id))!;
    const sameRound = eq(sheetApprovalSteps.round, sheets.round);
    let cond: SQL;
    if (scope === 'waiting') {
      const current = and(eq(sheets.status, 'submitted'), sameRound, eq(sheetApprovalSteps.position, sheets.currentStepPosition))!;
      cond = actor.level === 'admin' ? current : and(current, mine)!;
    } else if (scope === 'upcoming') {
      cond = and(eq(sheets.status, 'submitted'), sameRound, eq(sheetApprovalSteps.status, 'pending'), gt(sheetApprovalSteps.position, sheets.currentStepPosition), mine)!;
    } else {
      cond = eq(sheetApprovalSteps.decidedById, actor.id);
    }
    const base = db.select({
      sheet: sheets,
      employee: { id: users.id, firstName: users.firstName, lastName: users.lastName, employeeCode: users.employeeCode, teamId: users.teamId, teamName: teams.name },
      step: { position: sheetApprovalSteps.position, label: sheetApprovalSteps.label, status: sheetApprovalSteps.status, decidedAt: sheetApprovalSteps.decidedAt },
    }).from(sheetApprovalSteps).innerJoin(sheets, eq(sheets.id, sheetApprovalSteps.sheetId)).innerJoin(users, eq(users.id, sheets.employeeId)).leftJoin(teams, eq(teams.id, users.teamId)).where(cond);
    const order = scope === 'decided' ? desc(sheetApprovalSteps.decidedAt) : asc(sheets.submittedAt);
    const [rows, [{ total }]] = await Promise.all([
      base.orderBy(order).limit(p.limit).offset(p.offset),
      db.select({ total: count() }).from(sheetApprovalSteps).innerJoin(sheets, eq(sheets.id, sheetApprovalSteps.sheetId)).where(cond),
    ]);
    return paged(rows.map((r) => ({ ...SheetsService.toSummary({ sheet: r.sheet, employee: r.employee }), step: r.step })), Number(total), p);
  }
}
