import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { and, asc, count, eq, ilike, or, SQL } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { users } from '@/database/schema';
import { DomainError, notFound } from '@/common/errors/domain-error';
import { foreignKeyViolationConstraint, uniqueViolationConstraint } from '@/common/errors/pg';
import { paged, parsePagination } from '@/common/pagination';
import { Env } from '@/common/config/env';
import { AuditService } from '@/audit/audit.service';
import { MailService } from '@/mail/mail.service';
import { inviteEmail, resetEmail } from '@/mail/templates';
import { TokenService } from '@/auth/token.service';
import { AuthService, PublicUser, toPublicUser } from '@/auth/auth.service';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './users.dto';

@Injectable()
export class UsersService {
  constructor(private readonly drizzle: DrizzleService, private readonly tokens: TokenService, private readonly mail: MailService, private readonly config: ConfigService<Env, true>, private readonly audit: AuditService) {}

  async findById(id: string): Promise<PublicUser> {
    const [u] = await this.drizzle.db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound('User');
    return toPublicUser(u);
  }

  async list(q: ListUsersQueryDto) {
    const p = parsePagination(q);
    const where: SQL[] = [];
    if (q.search) where.push(or(ilike(users.firstName, `%${q.search}%`), ilike(users.lastName, `%${q.search}%`), ilike(users.email, `%${q.search}%`))!);
    if (q.role) where.push(eq(users.role, q.role));
    if (q.teamId) where.push(eq(users.teamId, q.teamId));
    if (q.isActive !== undefined) where.push(eq(users.isActive, q.isActive));
    const cond = where.length ? and(...where) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      this.drizzle.db.select().from(users).where(cond).orderBy(asc(users.lastName), asc(users.firstName)).limit(p.limit).offset(p.offset),
      this.drizzle.db.select({ total: count() }).from(users).where(cond),
    ]);
    return paged(rows.map(toPublicUser), Number(total), p);
  }

  async create(actorId: string, dto: CreateUserDto): Promise<PublicUser> {
    const email = dto.email.toLowerCase();
    let u: typeof users.$inferSelect;
    try {
      u = await this.drizzle.db.transaction(async (tx) => {
        const [row] = await tx.insert(users).values({ ...dto, email, timezone: dto.timezone ?? this.config.get('DEFAULT_TIMEZONE') }).returning();
        await this.audit.record(tx, { actorId, action: 'user.created', entityType: 'user', entityId: row.id, after: toPublicUser(row) });
        return row;
      });
    } catch (err) {
      throw this.mapDbError(err);
    }
    await this.sendInvite(u);
    return toPublicUser(u);
  }

  async update(actorId: string, id: string, dto: UpdateUserDto): Promise<PublicUser> {
    try {
      return await this.drizzle.db.transaction(async (tx) => {
        const [before] = await tx.select().from(users).where(eq(users.id, id));
        if (!before) throw notFound('User');
        const [u] = await tx.update(users).set({ ...dto, updatedAt: new Date() }).where(eq(users.id, id)).returning();
        await this.audit.record(tx, { actorId, action: 'user.updated', entityType: 'user', entityId: id, before: toPublicUser(before), after: toPublicUser(u) });
        return toPublicUser(u);
      });
    } catch (err) {
      throw this.mapDbError(err);
    }
  }

  async setActive(actorId: string, id: string, isActive: boolean): Promise<PublicUser> {
    return this.drizzle.db.transaction(async (tx) => {
      const [before] = await tx.select().from(users).where(eq(users.id, id));
      if (!before) throw notFound('User');
      const [u] = await tx.update(users).set({ isActive, updatedAt: new Date() }).where(eq(users.id, id)).returning();
      if (!isActive) await this.tokens.revokeAllForUser(id, tx);
      await this.audit.record(tx, { actorId, action: isActive ? 'user.reactivated' : 'user.deactivated', entityType: 'user', entityId: id, before: toPublicUser(before), after: toPublicUser(u) });
      return toPublicUser(u);
    });
  }

  async resendInvite(id: string): Promise<void> {
    const [u] = await this.drizzle.db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound('User');
    await this.sendInvite(u);
  }

  async forgotPassword(email: string): Promise<void> {
    const [u] = await this.drizzle.db.select().from(users).where(eq(users.email, email.toLowerCase()));
    if (!u || !u.isActive) return; // do not reveal existence
    const raw = await this.tokens.createPasswordToken(u.id, 'reset');
    await this.mail.send({ to: u.email, ...resetEmail(u.firstName, `${this.config.get('WEB_URL')}/reset-password?token=${raw}`) });
  }

  async updateMe(id: string, dto: { firstName?: string; lastName?: string; timezone?: string }): Promise<PublicUser> {
    return this.update(id, id, dto);
  }

  async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    const [u] = await this.drizzle.db.select().from(users).where(eq(users.id, id));
    if (!u?.passwordHash || !(await argon2.verify(u.passwordHash, currentPassword))) throw new DomainError('INVALID_CREDENTIALS', 'Current password is incorrect', 401);
    await this.drizzle.db.update(users).set({ passwordHash: await AuthService.hashPassword(newPassword), updatedAt: new Date() }).where(eq(users.id, id));
    await this.tokens.revokeAllForUser(id);
  }

  async listByRole(role: typeof users.$inferSelect.role): Promise<PublicUser[]> {
    const rows = await this.drizzle.db.select().from(users).where(and(eq(users.role, role), eq(users.isActive, true)));
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
    return err;
  }
}
