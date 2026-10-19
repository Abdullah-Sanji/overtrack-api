import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ZodValidationPipe } from 'nestjs-zod';
import { ApprovalChainsModule } from './approval-chains/approval-chains.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { validateEnv } from './common/config/env';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { OvertimeTypesModule } from './overtime-types/overtime-types.module';
import { SheetsModule } from './sheets/sheets.module';
import { TeamsModule } from './teams/teams.module';
import { UsersModule } from './users/users.module';
import { WorkflowModule } from './workflow/workflow.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env'] }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    MailModule,
    AuditModule,
    AuthModule,
    UsersModule,
    TeamsModule,
    ApprovalChainsModule,
    OvertimeTypesModule,
    SheetsModule,
    AttachmentsModule,
    WorkflowModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
