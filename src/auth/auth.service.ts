import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { users } from '@/database/schema';
import { Env } from '@/common/config/env';
import { DomainError } from '@/common/errors/domain-error';
import { TokenService } from './token.service';
import { GoogleTokenVerifier } from './google-token.verifier';
import { PublicUser, UserWithRole, toPublicUser, usersWithRole } from '@/users/public-user';

// Verified against when the user is unknown, so response time does not reveal whether an email exists.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= argon2.hash('dummy-password-for-timing', { type: argon2.argon2id }));

@Injectable()
export class AuthService {
  constructor(private readonly drizzle: DrizzleService, private readonly tokens: TokenService, private readonly google: GoogleTokenVerifier, private readonly config: ConfigService<Env, true>) {}

  static hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async login(email: string, password: string) {
    const [row] = await usersWithRole(this.drizzle.db).where(eq(users.email, email.toLowerCase()));
    const valid = await argon2.verify(row?.user.passwordHash ?? (await getDummyHash()), password).catch(() => false);
    if (!row || !row.user.passwordHash || !valid) {
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }
    return this.issueSession(row);
  }

  /** Google Identity Services credential → session. Email is the identity; no self sign-up. */
  async loginWithGoogle(credential: string) {
    if (!this.config.get('GOOGLE_CLIENT_ID')) throw new DomainError('GOOGLE_SIGNIN_DISABLED', 'Google sign-in is not configured', 503);
    const id = await this.google.verify(credential);
    if (!id.emailVerified) throw new DomainError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed, try again', 401);
    const [row] = await usersWithRole(this.drizzle.db).where(eq(users.email, id.email.toLowerCase()));
    if (!row) throw new DomainError('GOOGLE_ACCOUNT_UNKNOWN', 'No OverTrack account for this Google address. Ask your admin.', 403);
    return this.issueSession(row);
  }

  private async issueSession(row: UserWithRole) {
    if (!row.user.isActive) throw new DomainError('USER_INACTIVE', 'User is inactive', 401);
    const accessToken = await this.tokens.issueAccessToken({ id: row.user.id, roleId: row.user.roleId, level: row.role.level, teamId: row.user.teamId });
    const refresh = await this.tokens.createRefreshToken(row.user.id);
    return { accessToken, refresh, user: toPublicUser(row) };
  }

  async refresh(raw: string) {
    const { user, ...refresh } = await this.tokens.rotateRefreshToken(raw);
    const accessToken = await this.tokens.issueAccessToken({ id: user.user.id, roleId: user.user.roleId, level: user.role.level, teamId: user.user.teamId });
    return { accessToken, refresh };
  }

  async setPasswordByToken(raw: string, purpose: 'invite' | 'reset', password: string) {
    const userId = await this.tokens.consumePasswordToken(raw, purpose);
    await this.drizzle.db.update(users).set({ passwordHash: await AuthService.hashPassword(password), updatedAt: new Date() }).where(eq(users.id, userId));
    await this.tokens.revokeAllForUser(userId);
  }

  async me(id: string): Promise<PublicUser> {
    const [row] = await usersWithRole(this.drizzle.db).where(eq(users.id, id));
    if (!row) throw new DomainError('NOT_FOUND', 'User not found', 404);
    return toPublicUser(row);
  }
}
