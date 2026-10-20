import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Env } from '@/common/config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { GoogleTokenVerifier } from './google-token.verifier';

@Module({
  imports: [JwtModule.registerAsync({ global: true, inject: [ConfigService], useFactory: (c: ConfigService<Env, true>) => ({ secret: c.get('JWT_SECRET') }) })],
  controllers: [AuthController],
  providers: [AuthService, TokenService, GoogleTokenVerifier],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
