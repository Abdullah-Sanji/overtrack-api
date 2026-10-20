import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LEVELS_KEY } from './levels.decorator';
import { RoleLevel } from '@/database/schema';
import { AuthUser } from './auth-user';
import { forbidden } from '../errors/domain-error';

@Injectable()
export class LevelsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const levels = this.reflector.getAllAndOverride<RoleLevel[] | undefined>(LEVELS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!levels || levels.length === 0) return true;
    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user || !levels.includes(user.level)) throw forbidden('Insufficient role level');
    return true;
  }
}
