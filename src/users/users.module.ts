import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { MeController } from './me.controller';
import { PasswordController } from './password.controller';

@Module({ imports: [AuthModule], controllers: [UsersController, MeController, PasswordController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
