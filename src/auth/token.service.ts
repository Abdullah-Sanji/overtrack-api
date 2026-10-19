import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { DbOrTx, DrizzleService } from '@/database/drizzle.service';
import { refreshTokens, passwordTokens, users } from '@/database/schema';
import { Env } from '@/common/config/env';
import { DomainError } from '@/common/errors/domain-error';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class TokenService {
  constructor(private readonly drizzle: DrizzleService, private readonly jwt: JwtService, private readonly config: ConfigService<Env, true>) {}

  issueAccessToken(user: { id: string; role: string; teamId: string | null }): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, role: user.role, teamId: user.teamId }, { expiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS') });
  }

  async createRefreshToken(userId: string, familyId: string = randomUUID(), executor?: DbOrTx): Promise<{ raw: string; expiresAt: Date; id: string }> {
    const raw = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + this.config.get('REFRESH_TTL_DAYS') * 86_400_000);
    const [row] = await (executor ?? this.drizzle.db).insert(refreshTokens).values({ userId, familyId, tokenHash: sha256(raw), expiresAt }).returning({ id: refreshTokens.id });
    return { raw, expiresAt, id: row.id };
  }

  /** Rotates: revokes the presented token and issues a new one in the same family. Reuse of a revoked token kills the family. */
  async rotateRefreshToken(raw: string): Promise<{ raw: string; expiresAt: Date; user: typeof users.$inferSelect }> {
    const db = this.drizzle.db;
    const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw)));
    if (!row) throw new DomainError('TOKEN_INVALID', 'Unknown refresh token', 401);
    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      throw new DomainError('TOKEN_REUSED', 'Refresh token reuse detected', 401);
    }
    if (row.expiresAt < new Date()) throw new DomainError('TOKEN_EXPIRED', 'Refresh token expired', 401);
    const [user] = await db.select().from(users).where(eq(users.id, row.userId));
    if (!user || !user.isActive) throw new DomainError('USER_INACTIVE', 'User is inactive', 401);
    // Claim the old token atomically; only one concurrent caller can win.
    const next = await db.transaction(async (tx) => {
      const claimed = await tx.update(refreshTokens).set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt))).returning({ id: refreshTokens.id });
      if (claimed.length === 0) return null;
      const created = await this.createRefreshToken(row.userId, row.familyId, tx);
      await tx.update(refreshTokens).set({ replacedById: created.id }).where(eq(refreshTokens.id, row.id));
      return created;
    });
    if (!next) {
      await this.revokeFamily(row.familyId);
      throw new DomainError('TOKEN_REUSED', 'Refresh token reuse detected', 401);
    }
    return { raw: next.raw, expiresAt: next.expiresAt, user };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.drizzle.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
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

  async consumePasswordToken(raw: string, purpose: 'invite' | 'reset'): Promise<string> {
    const [row] = await this.drizzle.db.select().from(passwordTokens).where(and(eq(passwordTokens.tokenHash, sha256(raw)), eq(passwordTokens.purpose, purpose)));
    if (!row || row.usedAt) throw new DomainError('TOKEN_INVALID', 'Invalid token', 400);
    if (row.expiresAt < new Date()) throw new DomainError('TOKEN_EXPIRED', 'Token expired', 400);
    await this.drizzle.db.update(passwordTokens).set({ usedAt: new Date() }).where(eq(passwordTokens.id, row.id));
    return row.userId;
  }
}
