import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { users } from '@/database/schema';
import { DomainError } from '@/common/errors/domain-error';
import { TokenService } from './token.service';

export type PublicUser = Omit<typeof users.$inferSelect, 'passwordHash'>;
export const toPublicUser = ({ passwordHash: _p, ...rest }: typeof users.$inferSelect): PublicUser => rest;

@Injectable()
export class AuthService {
  constructor(private readonly drizzle: DrizzleService, private readonly tokens: TokenService) {}

  static hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async login(email: string, password: string) {
    const [user] = await this.drizzle.db.select().from(users).where(eq(users.email, email.toLowerCase()));
    if (!user || !user.passwordHash || !(await argon2.verify(user.passwordHash, password))) {
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }
    if (!user.isActive) throw new DomainError('USER_INACTIVE', 'User is inactive', 401);
    const accessToken = await this.tokens.issueAccessToken(user);
    const refresh = await this.tokens.createRefreshToken(user.id);
    return { accessToken, refresh, user: toPublicUser(user) };
  }

  async refresh(raw: string) {
    const { user, ...refresh } = await this.tokens.rotateRefreshToken(raw);
    const accessToken = await this.tokens.issueAccessToken(user);
    return { accessToken, refresh };
  }

  async setPasswordByToken(raw: string, purpose: 'invite' | 'reset', password: string) {
    const userId = await this.tokens.consumePasswordToken(raw, purpose);
    await this.drizzle.db.update(users).set({ passwordHash: await AuthService.hashPassword(password), updatedAt: new Date() }).where(eq(users.id, userId));
  }

  async me(id: string): Promise<PublicUser> {
    const [user] = await this.drizzle.db.select().from(users).where(eq(users.id, id));
    if (!user) throw new DomainError('NOT_FOUND', 'User not found', 404);
    return toPublicUser(user);
  }
}
