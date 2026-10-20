import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, asc, count, eq } from 'drizzle-orm';
import { DrizzleService, Tx } from '@/database/drizzle.service';
import { overtimeTypes, sheetApprovalSteps, sheetEntries, sheets, users } from '@/database/schema';
import { AuthUser } from '@/common/auth/auth-user';
import { DomainError } from '@/common/errors/domain-error';
import { AuditService } from '@/audit/audit.service';
import { ApprovalChainsService } from '@/approval-chains/approval-chains.service';
import { SheetsService, SheetSummary } from '@/sheets/sheets.service';
import { weighted } from '@/sheets/hours';
import { Action, transition, TransitionResult, TStep } from './transition';

@Injectable()
export class WorkflowService {
  constructor(private readonly drizzle: DrizzleService, private readonly sheetsSvc: SheetsService, private readonly chains: ApprovalChainsService, private readonly audit: AuditService, private readonly events: EventEmitter2) {}

  async act(actor: AuthUser, sheetId: string, action: Action, expectedVersion: number): Promise<SheetSummary> {
    const now = new Date();
    const { summary, result } = await this.drizzle.db.transaction(async (tx) => {
      const row = await this.sheetsSvc.lockForUpdate(tx, sheetId);
      if (row.version !== expectedVersion) throw new DomainError('SHEET_VERSION_CONFLICT', 'Sheet was modified by someone else; reload and try again', 409);
      const [{ entryCount }] = await tx.select({ entryCount: count() }).from(sheetEntries).where(eq(sheetEntries.sheetId, sheetId));
      const stepRows = await tx.select().from(sheetApprovalSteps).where(and(eq(sheetApprovalSteps.sheetId, sheetId), eq(sheetApprovalSteps.round, row.round))).orderBy(asc(sheetApprovalSteps.position));
      const steps: TStep[] = stepRows.map((s) => ({ position: s.position, label: s.label, approverId: s.approverId, backupApproverId: s.backupApproverId, status: s.status }));

      let effective = action;
      let submitTeamId: string | null = null;
      if (action.type === 'submit') {
        const [emp] = await tx.select({ teamId: users.teamId }).from(users).where(eq(users.id, row.employeeId));
        if (!emp?.teamId) throw new DomainError('USER_HAS_NO_TEAM', 'You must belong to a team before submitting', 409);
        effective = { type: 'submit', chain: await this.chains.snapshotInput(tx, emp.teamId) };
        submitTeamId = emp.teamId;
      }

      const result = transition(
        { id: row.id, employeeId: row.employeeId, status: row.status, round: row.round, currentStepPosition: row.currentStepPosition, submittedAt: row.submittedAt, entryCount: Number(entryCount) },
        steps, { id: actor.id, level: actor.level }, effective, now,
      );

      if (action.type === 'submit') {
        await this.resnapshotMultipliers(tx, sheetId);
        await this.sheetsSvc.recomputeTotals(tx, sheetId);
      }
      if (result.deleteCurrentRoundSteps) await tx.delete(sheetApprovalSteps).where(and(eq(sheetApprovalSteps.sheetId, sheetId), eq(sheetApprovalSteps.round, row.round)));
      if (result.insertSteps.length) await tx.insert(sheetApprovalSteps).values(result.insertSteps.map((s) => ({ sheetId, round: s.round, position: s.position, label: s.label, approverId: s.approverId, backupApproverId: s.backupApproverId, status: s.status, comment: s.comment, decidedAt: s.status === 'skipped' ? now : null })));
      for (const u of result.updateSteps) {
        await tx.update(sheetApprovalSteps).set({ status: u.status, decidedById: u.decidedById, decidedAt: u.decidedAt, comment: u.comment, overrideReason: u.overrideReason })
          .where(and(eq(sheetApprovalSteps.sheetId, sheetId), eq(sheetApprovalSteps.round, result.patch.round ?? row.round), eq(sheetApprovalSteps.position, u.position)));
      }
      const [updated] = await tx.update(sheets).set({ ...result.patch, ...(submitTeamId ? { teamId: submitTeamId } : {}), version: row.version + 1, updatedAt: now }).where(eq(sheets.id, sheetId)).returning();
      await this.audit.record(tx, { actorId: actor.id, action: result.auditAction, entityType: 'sheet', entityId: sheetId, reason: result.reason,
        before: { status: row.status, round: row.round, currentStepPosition: row.currentStepPosition }, after: { status: updated.status, round: updated.round, currentStepPosition: updated.currentStepPosition } });
      const raw = await this.sheetsSvc.findRaw(sheetId, tx);
      return { summary: SheetsService.toSummary(raw), result };
    });
    this.emit(result);
    return summary;
  }

  private emit(result: TransitionResult) {
    for (const e of result.events) this.events.emit(e.name, e.payload);
  }

  private async resnapshotMultipliers(tx: Tx, sheetId: string) {
    const rows = await tx.select({ id: sheetEntries.id, hours: sheetEntries.hours, multiplier: overtimeTypes.multiplier }).from(sheetEntries).innerJoin(overtimeTypes, eq(overtimeTypes.id, sheetEntries.overtimeTypeId)).where(eq(sheetEntries.sheetId, sheetId));
    for (const r of rows) {
      await tx.update(sheetEntries).set({ multiplierSnapshot: r.multiplier, weightedHours: weighted(Number(r.hours), Number(r.multiplier)).toFixed(2) }).where(eq(sheetEntries.id, r.id));
    }
  }

  async markPaidBulk(actor: AuthUser, items: Array<{ id: string; version: number }>, paymentReference: string, paidAt?: Date) {
    const paid: string[] = []; const failed: Array<{ id: string; code: string }> = [];
    for (const item of items) {
      try { await this.act(actor, item.id, { type: 'markPaid', paymentReference, paidAt }, item.version); paid.push(item.id); }
      catch (err) { failed.push({ id: item.id, code: err instanceof DomainError ? err.code : 'INTERNAL' }); }
    }
    return { paid, failed };
  }

  async timeline(actor: AuthUser, sheetId: string) {
    const r = await this.sheetsSvc.assertCanView(actor, sheetId);
    const audit = await this.audit.timelineForSheet(sheetId);
    const roundNums = await this.drizzle.db.selectDistinct({ round: sheetApprovalSteps.round }).from(sheetApprovalSteps).where(eq(sheetApprovalSteps.sheetId, sheetId)).orderBy(asc(sheetApprovalSteps.round));
    const rounds = await Promise.all(roundNums.map(async ({ round }) => ({ round, steps: await this.sheetsSvc.stepsOf(sheetId, round) })));
    return { sheetId: r.sheet.id, audit: audit.map((a) => ({ ...a, actor: a.actor?.id ? a.actor : null })), rounds };
  }
}
