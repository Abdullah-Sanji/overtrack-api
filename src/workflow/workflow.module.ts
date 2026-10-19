import { Module } from '@nestjs/common';
import { SheetsModule } from '@/sheets/sheets.module';
import { ApprovalChainsModule } from '@/approval-chains/approval-chains.module';
import { WorkflowService } from './workflow.service';
import { WorkflowController } from './workflow.controller';
import { InboxService } from './inbox.service';
import { InboxController } from './inbox.controller';
@Module({ imports: [SheetsModule, ApprovalChainsModule], controllers: [WorkflowController, InboxController], providers: [WorkflowService, InboxService], exports: [WorkflowService] })
export class WorkflowModule {}
