import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, SQL, sql } from 'drizzle-orm';
import { DrizzleService, DbOrTx } from '@/database/drizzle.service';
import { approvalChainSteps, teams, users } from '@/database/schema';
import { AuditService } from '@/audit/audit.service';
import { DomainError, notFound } from '@/common/errors/domain-error';
import { foreignKeyViolationConstraint, uniqueViolationConstraint } from '@/common/errors/pg';
import { paged, parsePagination } from '@/common/pagination';
import { toPublicUser, usersWithRole } from '@/users/public-user';
import { CreateTeamDto, ListTeamsQueryDto, UpdateTeamDto } from './teams.dto';

export interface TeamSummary {
  id: string; name: string; description: string | null; isActive: boolean; createdAt: Date; updatedAt: Date;
  techLead: { id: string; firstName: string; lastName: string } | null; memberCount: number; chainStepCount: number;
}

interface TeamSummaryRow {
  id: string; name: string; description: string | null; isActive: boolean; createdAt: Date; updatedAt: Date;
  techLeadId: string | null; techLeadFirst: string | null; techLeadLast: string | null;
  memberCount: number; chainStepCount: number;
}

@Injectable()
export class TeamsService {
  constructor(private readonly drizzle: DrizzleService, private readonly audit: AuditService) {}

  private summaryQuery(db: DbOrTx = this.drizzle.db) {
    return db
      .select({
        id: teams.id, name: teams.name, description: teams.description, isActive: teams.isActive, createdAt: teams.createdAt, updatedAt: teams.updatedAt,
        techLeadId: users.id, techLeadFirst: users.firstName, techLeadLast: users.lastName,
        memberCount: sql<number>`(select count(*) from users m where m.team_id = ${teams.id} and m.is_active)`.mapWith(Number),
        chainStepCount: sql<number>`(select count(*) from approval_chain_steps s where s.team_id = ${teams.id})`.mapWith(Number),
      })
      .from(teams)
      .leftJoin(users, eq(users.id, teams.techLeadId));
  }

  private toSummary(r: TeamSummaryRow): TeamSummary {
    const { techLeadId, techLeadFirst, techLeadLast, ...rest } = r;
    return { ...rest, techLead: techLeadId && techLeadFirst !== null && techLeadLast !== null ? { id: techLeadId, firstName: techLeadFirst, lastName: techLeadLast } : null };
  }

  async findById(id: string, db: DbOrTx = this.drizzle.db): Promise<TeamSummary> {
    const [r] = await this.summaryQuery(db).where(eq(teams.id, id));
    if (!r) throw notFound('Team');
    return this.toSummary(r);
  }

  async list(q: ListTeamsQueryDto) {
    const p = parsePagination(q);
    const where: SQL[] = [];
    if (q.search) where.push(ilike(teams.name, `%${q.search}%`));
    if (q.isActive !== undefined) where.push(eq(teams.isActive, q.isActive));
    const cond = where.length ? and(...where) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      this.summaryQuery().where(cond).orderBy(asc(teams.name)).limit(p.limit).offset(p.offset),
      this.drizzle.db.select({ total: count() }).from(teams).where(cond),
    ]);
    return paged(rows.map((r) => this.toSummary(r)), Number(total), p);
  }

  async create(actorId: string, dto: CreateTeamDto): Promise<TeamSummary> {
    try {
      return await this.drizzle.db.transaction(async (tx) => {
        const [t] = await tx.insert(teams).values(dto).returning({ id: teams.id });
        const after = await this.findById(t.id, tx);
        await this.audit.record(tx, { actorId, action: 'team.created', entityType: 'team', entityId: t.id, after });
        return after;
      });
    } catch (err) {
      throw this.mapDbError(err);
    }
  }

  async update(actorId: string, id: string, dto: UpdateTeamDto): Promise<TeamSummary> {
    try {
      return await this.drizzle.db.transaction(async (tx) => {
        const before = await this.findById(id, tx);
        await tx.update(teams).set({ ...dto, updatedAt: new Date() }).where(eq(teams.id, id));
        const after = await this.findById(id, tx);
        await this.audit.record(tx, { actorId, action: 'team.updated', entityType: 'team', entityId: id, before, after });
        return after;
      });
    } catch (err) {
      throw this.mapDbError(err);
    }
  }

  async members(id: string) {
    await this.findById(id);
    const rows = await usersWithRole(this.drizzle.db).where(and(eq(users.teamId, id), eq(users.isActive, true))).orderBy(asc(users.lastName));
    return rows.map(toPublicUser);
  }

  async chainStepsOf(teamId: string) {
    return this.drizzle.db.select().from(approvalChainSteps).where(eq(approvalChainSteps.teamId, teamId)).orderBy(asc(approvalChainSteps.position));
  }

  private mapDbError(err: unknown): unknown {
    if (uniqueViolationConstraint(err) === 'teams_name_unique') return new DomainError('TEAM_NAME_TAKEN', 'Team name already in use', 409);
    if (foreignKeyViolationConstraint(err) === 'teams_tech_lead_id_users_id_fk') return new DomainError('NOT_FOUND', 'Tech lead user not found', 404);
    return err;
  }
}
