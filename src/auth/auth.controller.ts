import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '@/common/auth/public.decorator';
import { Env } from '@/common/config/env';
import { DomainError } from '@/common/errors/domain-error';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { AcceptInviteDto, LoginDto, ResetPasswordDto } from './auth.dto';

export const REFRESH_COOKIE = 'ot_refresh';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly tokens: TokenService, private readonly config: ConfigService<Env, true>) {}

  private setRefreshCookie(reply: FastifyReply, raw: string, expiresAt: Date) {
    reply.setCookie(REFRESH_COOKIE, raw, { httpOnly: true, sameSite: 'lax', secure: this.config.get('NODE_ENV') === 'production', path: '/api/v1/auth', expires: expiresAt });
  }

  @Public() @Post('auth/login') @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const { accessToken, refresh, user } = await this.auth.login(dto.email, dto.password);
    this.setRefreshCookie(reply, refresh.raw, refresh.expiresAt);
    return { data: { accessToken, user } };
  }

  @Public() @Post('auth/refresh') @HttpCode(200)
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const raw = req.cookies[REFRESH_COOKIE];
    if (!raw) throw new DomainError('TOKEN_INVALID', 'Missing refresh cookie', 401);
    const { accessToken, refresh } = await this.auth.refresh(raw);
    this.setRefreshCookie(reply, refresh.raw, refresh.expiresAt);
    return { data: { accessToken } };
  }

  @Public() @Post('auth/logout') @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const raw = req.cookies[REFRESH_COOKIE];
    if (raw) await this.tokens.revokeRefreshToken(raw);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  @Public() @Post('auth/accept-invite') @HttpCode(204)
  async acceptInvite(@Body() dto: AcceptInviteDto) { await this.auth.setPasswordByToken(dto.token, 'invite', dto.password); }

  @Public() @Post('auth/reset-password') @HttpCode(204)
  async reset(@Body() dto: ResetPasswordDto) { await this.auth.setPasswordByToken(dto.token, 'reset', dto.password); }
}
