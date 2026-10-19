import { Injectable } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { asc, eq, inArray } from 'drizzle-orm';
import { DrizzleService, DbOrTx } from '@/database/drizzle.service';
import { approvalChainSteps, teams, users } from '@/database/schema';
import { DomainError, notFound } from '@/common/errors/domain-error';
import { AuditService } from '@/audit/audit.service';
import { ReplaceChainDto } from './approval-chains.dto';

export interface ChainStepInput { position: number; label: string; approverId: string; backupApproverId: string | null }
export interface ChainPerson { id: string; firstName: string; lastName: string; isActive: boolean }
export interface ChainStepView { id: string; position: number; label: string; approver: ChainPerson; backupApprover: ChainPerson | null }

@Injectable()
export class ApprovalChainsService {
  constructor(private readonly drizzle: DrizzleService, private readonly audit: AuditService) {}

  async getForTeam(teamId: string, db: DbOrTx = this.drizzle.db): Promise<ChainStepView[]> {
    const approver = alias(users, 'approver'); const backup = alias(users, 'backup');
    const rows = await db.select({
      id: approvalChainSteps.id, position: approvalChainSteps.position, label: approvalChainSteps.label,
      approver: { id: approver.id, firstName: approver.firstName, lastName: approver.lastName, isActive: approver.isActive },
      backup: { id: backup.id, firstName: backup.firstName, lastName: backup.lastName, isActive: backup.isActive },
    }).from(approvalChainSteps).innerJoin(approver, eq(approver.id, approvalChainSteps.approverId)).leftJoin(backup, eq(backup.id, approvalChainSteps.backupApproverId))
      .where(eq(approvalChainSteps.teamId, teamId)).orderBy(asc(approvalChainSteps.position));
    return rows.map((r) => ({ id: r.id, position: r.position, label: r.label, approver: r.approver, backupApprover: r.backup?.id ? (r.backup as ChainPerson) : null }));
  }

  async replaceForTeam(actorId: string, teamId: string, dto: ReplaceChainDto): Promise<ChainStepView[]> {
    const [team] = await this.drizzle.db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId));
    if (!team) throw notFound('Team');
    const ids = [...new Set(dto.steps.flatMap((s) => [s.approverId, s.backupApproverId].filter((x): x is string => Boolean(x))))];
    if (ids.length) {
      const found = await this.drizzle.db.select({ id: users.id, isActive: users.isActive }).from(users).where(inArray(users.id, ids));
      if (found.length !== ids.length) throw notFound('Approver');
      if (found.some((u) => !u.isActive)) throw new DomainError('CHAIN_APPROVER_INACTIVE', 'All approvers must be active users', 400);
    }
    return this.drizzle.db.transaction(async (tx) => {
      const before = await this.getForTeam(teamId, tx);
      await tx.delete(approvalChainSteps).where(eq(approvalChainSteps.teamId, teamId));
      if (dto.steps.length) {
        await tx.insert(approvalChainSteps).values(dto.steps.map((s, i) => ({ teamId, position: i + 1, label: s.label, approverId: s.approverId, backupApproverId: s.backupApproverId ?? null })));
      }
      const after = await this.getForTeam(teamId, tx);
      await this.audit.record(tx, { actorId, action: 'chain.replaced', entityType: 'chain', entityId: teamId, before, after });
      return after;
    });
  }

  /** The chain as it must be copied onto a sheet at submit time. */
  async snapshotInput(db: DbOrTx, teamId: string): Promise<ChainStepInput[]> {
    const steps = await this.getForTeam(teamId, db);
    if (steps.length === 0) throw new DomainError('CHAIN_EMPTY', 'This team has no approval chain configured', 409);
    if (steps.some((s) => !s.approver.isActive)) throw new DomainError('CHAIN_APPROVER_INACTIVE', 'An approver on this chain is inactive; ask an admin to fix the chain', 409);
    return steps.map((s) => ({ position: s.position, label: s.label, approverId: s.approver.id, backupApproverId: s.backupApprover?.isActive ? s.backupApprover.id : null }));
  }
}
