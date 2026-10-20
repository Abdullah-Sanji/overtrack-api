import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { sheets, users } from '@/database/schema';
import { Env } from '@/common/config/env';
import { dateToPeriod } from '@/common/zod';
import { genericEmail } from '@/mail/templates';
import { WorkflowEvent } from '@/workflow/transition';
import { NotificationsService } from './notifications.service';
import { UsersService } from '@/users/users.service';

type P = WorkflowEvent['payload'];

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);
  constructor(private readonly drizzle: DrizzleService, private readonly notifications: NotificationsService, private readonly users: UsersService, private readonly config: ConfigService<Env, true>) {}

  private async context(p: P) {
    const [row] = await this.drizzle.db.select({ period: sheets.period, firstName: users.firstName, lastName: users.lastName }).from(sheets).innerJoin(users, eq(users.id, sheets.employeeId)).where(eq(sheets.id, p.sheetId));
    const period = row ? dateToPeriod(row.period) : '';
    return { period, name: row ? `${row.firstName} ${row.lastName}` : 'An employee', web: this.config.get('WEB_URL') };
  }

  private safe(fn: () => Promise<void>) { return fn().catch((e) => this.logger.error(`notification failed: ${(e as Error).message}`)); }

  @OnEvent('sheet.submitted', { async: true })
  onSubmitted(p: P) { return this.safe(async () => {
    const c = await this.context(p); const link = `/approvals/${p.sheetId}`;
    await this.notifications.notify(p.approverIds, { type: 'sheet.submitted', title: 'Overtime sheet awaiting your approval', body: `${c.name} submitted the ${c.period} overtime sheet.`, link },
      genericEmail('Overtime sheet awaiting your approval', `${c.name} submitted the ${c.period} overtime sheet. Please review it.`, { label: 'Review sheet', href: `${c.web}${link}` }));
  }); }

  @OnEvent('sheet.step_approved', { async: true })
  onStepApproved(p: P) { return this.safe(async () => {
    const c = await this.context(p);
    await this.notifications.notify([p.employeeId], { type: 'sheet.step_approved', title: 'A step of your sheet was approved', body: `Your ${c.period} sheet moved to the next approver.`, link: `/sheets/${p.sheetId}` });
    await this.notifications.notify(p.approverIds, { type: 'sheet.submitted', title: 'Overtime sheet awaiting your approval', body: `${c.name}'s ${c.period} sheet is now at your step.`, link: `/approvals/${p.sheetId}` },
      genericEmail('Overtime sheet awaiting your approval', `${c.name}'s ${c.period} overtime sheet is now at your step.`, { label: 'Review sheet', href: `${c.web}/approvals/${p.sheetId}` }));
  }); }

  @OnEvent('sheet.approved', { async: true })
  onApproved(p: P) { return this.safe(async () => {
    const c = await this.context(p);
    await this.notifications.notify([p.employeeId], { type: 'sheet.approved', title: 'Your overtime sheet was approved', body: `Your ${c.period} sheet is fully approved and waiting for payment.`, link: `/sheets/${p.sheetId}` },
      genericEmail('Your overtime sheet was approved', `Your ${c.period} overtime sheet is fully approved and has been passed to finance.`, { label: 'Open sheet', href: `${c.web}/sheets/${p.sheetId}` }));
    const finance = await this.users.listByLevel('finance');
    await this.notifications.notify(finance.map((f) => f.id), { type: 'sheet.approved', title: 'Sheet ready for payment', body: `${c.name}'s ${c.period} sheet is approved.`, link: `/payments` });
  }); }

  @OnEvent('sheet.rejected', { async: true })
  onRejected(p: P) { return this.safe(async () => {
    const c = await this.context(p);
    await this.notifications.notify([p.employeeId], { type: 'sheet.rejected', title: 'Your overtime sheet was rejected', body: `Reason: ${p.reason ?? ''}`, link: `/sheets/${p.sheetId}` },
      genericEmail('Your overtime sheet was rejected', `Your ${c.period} overtime sheet was rejected. Reason: ${p.reason ?? ''}. Fix it and resubmit.`, { label: 'Open sheet', href: `${c.web}/sheets/${p.sheetId}` }));
  }); }

  @OnEvent('sheet.withdrawn', { async: true })
  onWithdrawn(p: P) { return this.safe(async () => {
    const c = await this.context(p);
    await this.notifications.notify(p.approverIds, { type: 'sheet.withdrawn', title: 'Sheet withdrawn', body: `${c.name} withdrew the ${c.period} sheet.`, link: null });
  }); }

  @OnEvent('sheet.reopened', { async: true })
  onReopened(p: P) { return this.safe(async () => {
    await this.notifications.notify([p.employeeId], { type: 'sheet.reopened', title: 'Your sheet was reopened by an admin', body: `Reason: ${p.reason ?? ''}`, link: `/sheets/${p.sheetId}` });
  }); }

  @OnEvent('sheet.paid', { async: true })
  onPaid(p: P) { return this.safe(async () => {
    const c = await this.context(p);
    await this.notifications.notify([p.employeeId], { type: 'sheet.paid', title: 'Your overtime was paid', body: `Your ${c.period} sheet is marked as paid.`, link: `/sheets/${p.sheetId}` },
      genericEmail('Your overtime was paid', `Your ${c.period} overtime sheet has been marked as paid.`, { label: 'Open sheet', href: `${c.web}/sheets/${p.sheetId}` }));
  }); }

  @OnEvent('sheet.payment_reverted', { async: true })
  onPaymentReverted(p: P) { return this.safe(async () => {
    const c = await this.context(p);
    await this.notifications.notify([p.employeeId], { type: 'sheet.payment_reverted', title: 'Payment status reverted', body: `Your ${c.period} sheet is back to approved. Reason: ${p.reason ?? ''}`, link: `/sheets/${p.sheetId}` });
  }); }
}
