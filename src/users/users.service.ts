import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { and, asc, count, eq, ilike, or, sql, SQL } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { users, roles, RoleLevel } from '@/database/schema';
import { DomainError, notFound } from '@/common/errors/domain-error';
import { foreignKeyViolationConstraint, uniqueViolationConstraint } from '@/common/errors/pg';
import { paged, parsePagination } from '@/common/pagination';
import { Env } from '@/common/config/env';
import { AuditService } from '@/audit/audit.service';
import { MailService } from '@/mail/mail.service';
import { inviteEmail, resetEmail } from '@/mail/templates';
import { TokenService } from '@/auth/token.service';
import { AuthService } from '@/auth/auth.service';
import { PublicUser, UserWithRole, roleRef, toPublicUser, usersWithRole } from './public-user';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './users.dto';

@Injectable()
export class UsersService {
  constructor(private readonly drizzle: DrizzleService, private readonly tokens: TokenService, private readonly mail: MailService, private readonly config: ConfigService<Env, true>, private readonly audit: AuditService) {}

  async remove(actorId: string, id: string): Promise<void> {
    if (actorId === id) throw new DomainError('CANNOT_DELETE_SELF', 'You cannot delete your own account', 409);
    await this.drizzle.db.transaction(async (tx) => {
      const [row] = await usersWithRole(tx).where(eq(users.id, id));
      if (!row) throw notFound('User');
      const res = await tx.execute<{ has_history: boolean }>(sql`
        select (
          exists(select 1 from sheets where employee_id = ${id} or paid_by_id = ${id})
          or exists(select 1 from sheet_entries where requested_by_id = ${id})
          or exists(select 1 from attachments where owner_id = ${id})
          or exists(select 1 from sheet_approval_steps where approver_id = ${id} or backup_approver_id = ${id} or decided_by_id = ${id})
          or exists(select 1 from audit_log where actor_id = ${id})
          or exists(select 1 from approval_chain_steps where approver_id = ${id} or backup_approver_id = ${id})
          or exists(select 1 from teams where tech_lead_id = ${id})
        ) as has_history`);
      if (res.rows[0]?.has_history) throw new DomainError('USER_HAS_HISTORY', 'This user has history (sheets, approvals or audit entries). Deactivate them instead.', 409);
      await tx.delete(users).where(eq(users.id, id)); // notifications and tokens cascade
      await this.audit.record(tx, { actorId, action: 'user.deleted', entityType: 'user', entityId: id, before: toPublicUser(row) });
    });
  }

  async findById(id: string): Promise<PublicUser> {
    const [row] = await usersWithRole(this.drizzle.db).where(eq(users.id, id));
    if (!row) throw notFound('User');
    return toPublicUser(row);
  }

  async list(q: ListUsersQueryDto) {
    const p = parsePagination(q);
    const where: SQL[] = [];
    if (q.search) where.push(or(ilike(users.firstName, `%${q.search}%`), ilike(users.lastName, `%${q.search}%`), ilike(users.email, `%${q.search}%`))!);
    if (q.roleId) where.push(eq(users.roleId, q.roleId));
    if (q.teamId) where.push(eq(users.teamId, q.teamId));
    if (q.department) where.push(sql`lower(${users.department}) = lower(${q.department})`);
    if (q.isActive !== undefined) where.push(eq(users.isActive, q.isActive));
    const cond = where.length ? and(...where) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      usersWithRole(this.drizzle.db).where(cond).orderBy(asc(users.lastName), asc(users.firstName)).limit(p.limit).offset(p.offset),
      this.drizzle.db.select({ total: count() }).from(users).where(cond),
    ]);
    return paged(rows.map(toPublicUser), Number(total), p);
  }

  /** Distinct departments, de-duplicated case-insensitively (which casing wins within a group is unspecified). */
  async departments(): Promise<string[]> {
    const res = await this.drizzle.db.execute<{ d: string }>(sql`select min(department) as d from users where department is not null group by lower(department) order by lower(min(department))`);
    return res.rows.map((r) => r.d);
  }

  async directory(search?: string) {
    const where: SQL[] = [eq(users.isActive, true)];
    if (search) where.push(or(ilike(users.firstName, `%${search}%`), ilike(users.lastName, `%${search}%`))!);
    return this.drizzle.db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, teamId: users.teamId, role: roleRef })
      .from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(and(...where)).orderBy(asc(users.lastName), asc(users.firstName)).limit(200);
  }

  async create(actorId: string, dto: CreateUserDto): Promise<PublicUser> {
    const email = dto.email.toLowerCase();
    let created: UserWithRole;
    try {
      created = await this.drizzle.db.transaction(async (tx) => {
        const [{ id }] = await tx.insert(users).values({ ...dto, email, timezone: dto.timezone ?? this.config.get('DEFAULT_TIMEZONE') }).returning({ id: users.id });
        const [row] = await usersWithRole(tx).where(eq(users.id, id));
        await this.audit.record(tx, { actorId, action: 'user.created', entityType: 'user', entityId: id, after: toPublicUser(row) });
        return row;
      });
    } catch (err) {
      throw this.mapDbError(err);
    }
    await this.sendInvite(created.user);
    return toPublicUser(created);
  }

  async update(actorId: string, id: string, dto: UpdateUserDto): Promise<PublicUser> {
    try {
      return await this.drizzle.db.transaction(async (tx) => {
        const [before] = await usersWithRole(tx).where(eq(users.id, id));
        if (!before) throw notFound('User');
        if (id === actorId && dto.roleId) {
          const [target] = await tx.select({ level: roles.level }).from(roles).where(eq(roles.id, dto.roleId));
          if (target && target.level !== 'admin') throw new DomainError('CANNOT_DEMOTE_SELF', 'You cannot remove admin level from your own account', 409);
        }
        await tx.update(users).set({ ...dto, updatedAt: new Date() }).where(eq(users.id, id));
        const [after] = await usersWithRole(tx).where(eq(users.id, id));
        await this.audit.record(tx, { actorId, action: 'user.updated', entityType: 'user', entityId: id, before: toPublicUser(before), after: toPublicUser(after) });
        return toPublicUser(after);
      });
    } catch (err) {
      throw this.mapDbError(err);
    }
  }

  async setActive(actorId: string, id: string, isActive: boolean): Promise<PublicUser> {
    return this.drizzle.db.transaction(async (tx) => {
      const [before] = await usersWithRole(tx).where(eq(users.id, id));
      if (!before) throw notFound('User');
      await tx.update(users).set({ isActive, updatedAt: new Date() }).where(eq(users.id, id));
      const [after] = await usersWithRole(tx).where(eq(users.id, id));
      if (!isActive) await this.tokens.revokeAllForUser(id, tx);
      await this.audit.record(tx, { actorId, action: isActive ? 'user.reactivated' : 'user.deactivated', entityType: 'user', entityId: id, before: toPublicUser(before), after: toPublicUser(after) });
      return toPublicUser(after);
    });
  }

  async resendInvite(id: string): Promise<void> {
    const [row] = await usersWithRole(this.drizzle.db).where(eq(users.id, id));
    if (!row) throw notFound('User');
    await this.sendInvite(row.user);
  }

  async forgotPassword(email: string): Promise<void> {
    const [row] = await usersWithRole(this.drizzle.db).where(eq(users.email, email.toLowerCase()));
    const u = row?.user;
    if (!u || !u.isActive) return; // do not reveal existence
    const raw = await this.tokens.createPasswordToken(u.id, 'reset');
    await this.mail.send({ to: u.email, ...resetEmail(u.firstName, `${this.config.get('WEB_URL')}/reset-password?token=${raw}`) });
  }

  async updateMe(id: string, dto: { firstName?: string; lastName?: string; timezone?: string }): Promise<PublicUser> {
    return this.update(id, id, dto);
  }

  async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    const [row] = await usersWithRole(this.drizzle.db).where(eq(users.id, id));
    const u = row?.user;
    if (!u?.passwordHash || !(await argon2.verify(u.passwordHash, currentPassword))) throw new DomainError('INVALID_CREDENTIALS', 'Current password is incorrect', 401);
    await this.drizzle.db.update(users).set({ passwordHash: await AuthService.hashPassword(newPassword), updatedAt: new Date() }).where(eq(users.id, id));
    await this.tokens.revokeAllForUser(id);
  }

  async listByLevel(level: RoleLevel): Promise<PublicUser[]> {
    const rows = await usersWithRole(this.drizzle.db).where(and(eq(roles.level, level), eq(users.isActive, true)));
    return rows.map(toPublicUser);
  }

  private async sendInvite(u: typeof users.$inferSelect) {
    const raw = await this.tokens.createPasswordToken(u.id, 'invite');
    await this.mail.send({ to: u.email, ...inviteEmail(u.firstName, `${this.config.get('WEB_URL')}/accept-invite?token=${raw}`) });
  }

  private mapDbError(err: unknown): unknown {
    const constraint = uniqueViolationConstraint(err);
    if (constraint === 'users_email_idx') return new DomainError('EMAIL_TAKEN', 'Email already in use', 409);
    if (constraint === 'users_employee_code_idx') return new DomainError('EMPLOYEE_CODE_TAKEN', 'Employee code already in use', 409);
    if (foreignKeyViolationConstraint(err) === 'users_team_id_teams_id_fk') return new DomainError('NOT_FOUND', 'Team not found', 404);
    if (foreignKeyViolationConstraint(err) === 'users_role_id_roles_id_fk') return new DomainError('NOT_FOUND', 'Role not found', 404);
    return err;
  }
}
