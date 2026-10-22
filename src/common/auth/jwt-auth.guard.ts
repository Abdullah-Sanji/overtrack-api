import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { IS_PUBLIC } from './public.decorator';
import { DomainError } from '../errors/domain-error';
import { DrizzleService } from '@/database/drizzle.service';
import { roles, users } from '@/database/schema';
import { AuthUser } from './auth-user';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly drizzle: DrizzleService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { user?: AuthUser }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new DomainError('UNAUTHORIZED', 'Missing bearer token', 401);
    let sub: string;
    try {
      sub = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub;
    } catch {
      throw new DomainError('TOKEN_EXPIRED', 'Invalid or expired token', 401);
    }
    // The token only proves identity. Role, team and active flag come from the database on every
    // request, so deactivating or demoting a user takes effect immediately instead of at token expiry.
    const [row] = await this.drizzle.db
      .select({ id: users.id, roleId: users.roleId, teamId: users.teamId, isActive: users.isActive, level: roles.level })
      .from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, sub));
    if (!row || !row.isActive) throw new DomainError('USER_INACTIVE', 'User is inactive', 401);
    req.user = { id: row.id, roleId: row.roleId, level: row.level, teamId: row.teamId };
    return true;
  }
}
