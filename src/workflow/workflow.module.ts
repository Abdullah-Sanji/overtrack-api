import { Module } from '@nestjs/common';
import { SheetsModule } from '@/sheets/sheets.module';
import { ApprovalChainsModule } from '@/approval-chains/approval-chains.module';
import { WorkflowService } from './workflow.service';
import { WorkflowController } from './workflow.controller';
@Module({ imports: [SheetsModule, ApprovalChainsModule], controllers: [WorkflowController], providers: [WorkflowService], exports: [WorkflowService] })
export class WorkflowModule {}
