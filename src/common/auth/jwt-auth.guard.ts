import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { FastifyRequest } from 'fastify';
import { IS_PUBLIC } from './public.decorator';
import { DomainError } from '../errors/domain-error';
import { AuthUser } from './auth-user';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { user?: AuthUser }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new DomainError('UNAUTHORIZED', 'Missing bearer token', 401);
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: AuthUser['role']; teamId: string | null }>(token);
      req.user = { id: payload.sub, role: payload.role, teamId: payload.teamId ?? null };
      return true;
    } catch {
      throw new DomainError('TOKEN_EXPIRED', 'Invalid or expired token', 401);
    }
  }
}
