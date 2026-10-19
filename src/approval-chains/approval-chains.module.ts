import { Module } from '@nestjs/common';
import { ApprovalChainsService } from './approval-chains.service';
import { ApprovalChainsController } from './approval-chains.controller';
@Module({ controllers: [ApprovalChainsController], providers: [ApprovalChainsService], exports: [ApprovalChainsService] })
export class ApprovalChainsModule {}
