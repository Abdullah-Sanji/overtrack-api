import { Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '@/audit/audit.service';
import { DomainError, notFound } from '@/common/errors/domain-error';
import { uniqueViolationConstraint } from '@/common/errors/pg';
import { DbOrTx, DrizzleService } from '@/database/drizzle.service';
import { roles, RoleLevel, SYSTEM_ROLES } from '@/database/schema';
import { CreateRoleDto, UpdateRoleDto } from './roles.dto';

export interface RoleView { id: string; name: string; level: RoleLevel; isSystem: boolean; userCount: number; createdAt: Date; updatedAt: Date }

@Injectable()
export class RolesService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly audit: AuditService,
  ) {}

  /** Inserts the six system roles when missing (matched case-insensitively by name) and returns name → id. */
  async ensureSystemRoles(db: DbOrTx = this.drizzle.db): Promise<Map<string, string>> {
    await db
      .insert(roles)
      .values(SYSTEM_ROLES.map((r) => ({ ...r, isSystem: true })))
      .onConflictDoNothing();
    const rows = await db.select({ id: roles.id, name: roles.name }).from(roles);
    return new Map(rows.map((r) => [r.name, r.id]));
  }

  private viewQuery(db: DbOrTx = this.drizzle.db) {
    return db
      .select({
        id: roles.id, name: roles.name, level: roles.level, isSystem: roles.isSystem, createdAt: roles.createdAt, updatedAt: roles.updatedAt,
        userCount: sql<number>`(select count(*) from users u where u.role_id = roles.id)`.mapWith(Number),
      })
      .from(roles);
  }

  async list(): Promise<RoleView[]> {
    return this.viewQuery().orderBy(asc(roles.name));
  }

  async findById(id: string, db: DbOrTx = this.drizzle.db): Promise<RoleView> {
    const [r] = await this.viewQuery(db).where(eq(roles.id, id));
    if (!r) throw notFound('Role');
    return r;
  }

  async create(actorId: string, dto: CreateRoleDto): Promise<RoleView> {
    try {
      return await this.drizzle.db.transaction(async (tx) => {
        const [row] = await tx.insert(roles).values(dto).returning({ id: roles.id });
        const after = await this.findById(row.id, tx);
        await this.audit.record(tx, { actorId, action: 'role.created', entityType: 'role', entityId: row.id, after });
        return after;
      });
    } catch (err) {
      throw this.mapDbError(err);
    }
  }

  async update(actor: { id: string; roleId: string }, id: string, dto: UpdateRoleDto): Promise<RoleView> {
    try {
      return await this.drizzle.db.transaction(async (tx) => {
        const before = await this.findById(id, tx);
        if (dto.level !== undefined && dto.level !== before.level) {
          if (before.isSystem) throw new DomainError('ROLE_IS_SYSTEM', 'The level of a system role cannot be changed', 409);
          if (id === actor.roleId && dto.level !== 'admin') throw new DomainError('CANNOT_DEMOTE_SELF', 'You cannot remove admin level from your own role', 409);
        }
        await tx.update(roles).set({ ...dto, updatedAt: new Date() }).where(eq(roles.id, id));
        const after = await this.findById(id, tx);
        await this.audit.record(tx, { actorId: actor.id, action: 'role.updated', entityType: 'role', entityId: id, before, after });
        return after;
      });
    } catch (err) {
      throw this.mapDbError(err);
    }
  }

  async remove(actorId: string, id: string): Promise<void> {
    await this.drizzle.db.transaction(async (tx) => {
      const before = await this.findById(id, tx);
      if (before.isSystem) throw new DomainError('ROLE_IS_SYSTEM', 'System roles cannot be deleted', 409);
      if (before.userCount > 0) throw new DomainError('ROLE_IN_USE', `${before.userCount} user(s) still have this role`, 409);
      await tx.delete(roles).where(eq(roles.id, id));
      await this.audit.record(tx, { actorId, action: 'role.deleted', entityType: 'role', entityId: id, before });
    });
  }

  private mapDbError(err: unknown): unknown {
    if (uniqueViolationConstraint(err) === 'roles_name_idx') return new DomainError('ROLE_NAME_TAKEN', 'A role with this name already exists', 409);
    return err;
  }
}
