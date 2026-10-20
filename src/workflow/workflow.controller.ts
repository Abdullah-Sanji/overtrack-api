import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { Levels } from '@/common/auth/levels.decorator';
import { WorkflowService } from './workflow.service';
import { ApproveDto, MarkPaidBulkDto, MarkPaidDto, ReasonDto, RejectDto, SubmitDto, WithdrawDto } from './workflow.dto';

@Controller('sheets')
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}
  private wrap = async (p: Promise<unknown>) => ({ data: await p });

  @Post('mark-paid') @HttpCode(200) @Levels('finance', 'admin')
  bulk(@Body() dto: MarkPaidBulkDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.markPaidBulk(a, dto.sheets, dto.paymentReference, dto.paidAt ? new Date(dto.paidAt) : undefined)); }

  @Get(':id/timeline') timeline(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.timeline(a, id)); }

  @Post(':id/submit') @HttpCode(200) submit(@Param('id', ParseUUIDPipe) id: string, @Body() d: SubmitDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.act(a, id, { type: 'submit', chain: [] }, d.version)); }
  @Post(':id/withdraw') @HttpCode(200) withdraw(@Param('id', ParseUUIDPipe) id: string, @Body() d: WithdrawDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.act(a, id, { type: 'withdraw' }, d.version)); }
  @Post(':id/approve') @HttpCode(200) approve(@Param('id', ParseUUIDPipe) id: string, @Body() d: ApproveDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.act(a, id, { type: 'approve', comment: d.comment, overrideReason: d.overrideReason }, d.version)); }
  @Post(':id/reject') @HttpCode(200) reject(@Param('id', ParseUUIDPipe) id: string, @Body() d: RejectDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.act(a, id, { type: 'reject', reason: d.reason, overrideReason: d.overrideReason }, d.version)); }
  @Post(':id/reopen') @HttpCode(200) @Levels('admin') reopen(@Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.act(a, id, { type: 'reopen', reason: d.reason }, d.version)); }
  @Post(':id/mark-paid') @HttpCode(200) @Levels('finance', 'admin') markPaid(@Param('id', ParseUUIDPipe) id: string, @Body() d: MarkPaidDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.act(a, id, { type: 'markPaid', paymentReference: d.paymentReference, paidAt: d.paidAt ? new Date(d.paidAt) : undefined }, d.version)); }
  @Post(':id/revert-paid') @HttpCode(200) @Levels('finance', 'admin') revertPaid(@Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.act(a, id, { type: 'revertPaid', reason: d.reason }, d.version)); }
}
