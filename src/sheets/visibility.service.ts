import { Injectable } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { approvalChainSteps, sheetApprovalSteps, teams } from '@/database/schema';
import { AuthUser } from '@/common/auth/auth-user';

@Injectable()
export class VisibilityService {
  constructor(private readonly drizzle: DrizzleService) {}

  /** Teams the actor may see consolidated data for. */
  async visibleTeamIds(actor: AuthUser): Promise<string[] | 'all'> {
    if (actor.role === 'admin' || actor.role === 'finance') return 'all';
    const db = this.drizzle.db;
    const [led, onChain] = await Promise.all([
      db.select({ id: teams.id }).from(teams).where(eq(teams.techLeadId, actor.id)),
      db.selectDistinct({ id: approvalChainSteps.teamId }).from(approvalChainSteps).where(or(eq(approvalChainSteps.approverId, actor.id), eq(approvalChainSteps.backupApproverId, actor.id))),
    ]);
    return [...new Set([...led, ...onChain].map((r) => r.id))];
  }

  async canViewSheet(actor: AuthUser, sheet: { id: string; employeeId: string; teamId: string | null }): Promise<boolean> {
    if (sheet.employeeId === actor.id) return true;
    const visible = await this.visibleTeamIds(actor);
    if (visible === 'all') return true;
    if (sheet.teamId && visible.includes(sheet.teamId)) return true;
    // approvers named on the sheet's own snapshot (the team chain may have changed since submission)
    const [named] = await this.drizzle.db.select({ id: sheetApprovalSteps.id }).from(sheetApprovalSteps)
      .where(and(eq(sheetApprovalSteps.sheetId, sheet.id), or(eq(sheetApprovalSteps.approverId, actor.id), eq(sheetApprovalSteps.backupApproverId, actor.id))))
      .limit(1);
    return Boolean(named);
  }
}
