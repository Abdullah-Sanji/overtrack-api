import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DbOrTx, DrizzleService } from '@/database/drizzle.service';
import { refreshTokens, passwordTokens, users, RoleLevel } from '@/database/schema';
import { usersWithRole, UserWithRole } from '@/users/public-user';
import { Env } from '@/common/config/env';
import { DomainError } from '@/common/errors/domain-error';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** How long a just-rotated refresh token may still be presented by another tab before it counts as theft. */
export const REFRESH_REUSE_GRACE_MS = 10_000;

@Injectable()
export class TokenService {
  constructor(private readonly drizzle: DrizzleService, private readonly jwt: JwtService, private readonly config: ConfigService<Env, true>) {}

  issueAccessToken(user: { id: string; roleId: string; level: RoleLevel; teamId: string | null }): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, roleId: user.roleId, level: user.level, teamId: user.teamId }, { expiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS') });
  }

  async createRefreshToken(userId: string, familyId: string = randomUUID(), executor?: DbOrTx, absoluteExpiresAt?: Date): Promise<{ raw: string; expiresAt: Date; id: string }> {
    const raw = randomBytes(48).toString('hex');
    // rotation passes the family's original expiry so a session never outlives its absolute lifetime
    const expiresAt = absoluteExpiresAt ?? new Date(Date.now() + this.config.get('REFRESH_TTL_DAYS') * 86_400_000);
    const [row] = await (executor ?? this.drizzle.db).insert(refreshTokens).values({ userId, familyId, tokenHash: sha256(raw), expiresAt }).returning({ id: refreshTokens.id });
    return { raw, expiresAt, id: row.id };
  }

  /**
   * Rotates: revokes the presented token and issues a new one in the same family. Reuse of a revoked
   * token kills the family, except within a short grace window after a rotation: several tabs restoring
   * at once all present the same cookie, and each must end up with its own live token instead of
   * logging the user out. A token revoked by logout has no replacement and gets no grace.
   */
  async rotateRefreshToken(raw: string): Promise<{ raw: string; expiresAt: Date; user: UserWithRole }> {
    const db = this.drizzle.db;
    const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw)));
    if (!row) throw new DomainError('TOKEN_INVALID', 'Unknown refresh token', 401);
    const justRotated = row.revokedAt !== null && row.replacedById !== null && Date.now() - row.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS;
    if (row.revokedAt && !justRotated) {
      await this.revokeFamily(row.familyId);
      throw new DomainError('TOKEN_REUSED', 'Refresh token reuse detected', 401);
    }
    if (row.expiresAt < new Date()) throw new DomainError('TOKEN_EXPIRED', 'Refresh token expired', 401);
    const [user] = await usersWithRole(db).where(eq(users.id, row.userId));
    if (!user || !user.user.isActive) throw new DomainError('USER_INACTIVE', 'User is inactive', 401);
    if (justRotated) {
      const sibling = await this.createRefreshToken(row.userId, row.familyId, undefined, row.expiresAt);
      return { raw: sibling.raw, expiresAt: sibling.expiresAt, user };
    }
    // Claim the old token atomically; only one concurrent caller can win.
    const next = await db.transaction(async (tx) => {
      const claimed = await tx.update(refreshTokens).set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt))).returning({ id: refreshTokens.id });
      if (claimed.length === 0) return null;
      const created = await this.createRefreshToken(row.userId, row.familyId, tx, row.expiresAt);
      await tx.update(refreshTokens).set({ replacedById: created.id }).where(eq(refreshTokens.id, row.id));
      return created;
    });
    if (next) return { raw: next.raw, expiresAt: next.expiresAt, user };
    // Lost the race to a concurrent rotation that happened microseconds ago: the same multi-tab case.
    const [latest] = await db.select({ revokedAt: refreshTokens.revokedAt, replacedById: refreshTokens.replacedById }).from(refreshTokens).where(eq(refreshTokens.id, row.id));
    if (latest?.replacedById && latest.revokedAt && Date.now() - latest.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS) {
      const sibling = await this.createRefreshToken(row.userId, row.familyId, undefined, row.expiresAt);
      return { raw: sibling.raw, expiresAt: sibling.expiresAt, user };
    }
    await this.revokeFamily(row.familyId);
    throw new DomainError('TOKEN_REUSED', 'Refresh token reuse detected', 401);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.drizzle.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async revokeAllForUser(userId: string, executor?: DbOrTx): Promise<void> {
    await (executor ?? this.drizzle.db).update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  async revokeRefreshToken(raw: string): Promise<void> {
    await this.drizzle.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, sha256(raw)));
  }

  async createPasswordToken(userId: string, purpose: 'invite' | 'reset'): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    const ttlMs = purpose === 'invite' ? 24 * 3_600_000 : 3_600_000;
    await this.drizzle.db.insert(passwordTokens).values({ userId, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs) });
    return raw;
  }

  /** Marks the token used in one atomic UPDATE so two concurrent presentations cannot both succeed. */
  async consumePasswordToken(raw: string, purpose: 'invite' | 'reset'): Promise<string> {
    const now = new Date();
    const [row] = await this.drizzle.db.update(passwordTokens).set({ usedAt: now })
      .where(and(eq(passwordTokens.tokenHash, sha256(raw)), eq(passwordTokens.purpose, purpose), isNull(passwordTokens.usedAt), gt(passwordTokens.expiresAt, now)))
      .returning({ userId: passwordTokens.userId });
    if (row) return row.userId;
    const [stale] = await this.drizzle.db.select({ expiresAt: passwordTokens.expiresAt, usedAt: passwordTokens.usedAt }).from(passwordTokens)
      .where(and(eq(passwordTokens.tokenHash, sha256(raw)), eq(passwordTokens.purpose, purpose)));
    if (stale && !stale.usedAt && stale.expiresAt < now) throw new DomainError('TOKEN_EXPIRED', 'Token expired', 400);
    throw new DomainError('TOKEN_INVALID', 'Invalid token', 400);
  }
}
