import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam, createOvertimeType, createSheet, createEntry, submittedSheet } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { MailService } from '@/mail/mail.service';
import { ReminderService } from '@/notifications/reminder.service';

const flush = () => new Promise((r) => setTimeout(r, 50));

describe('notifications', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let mail: MailService;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; mail = app.get(MailService); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); mail.sent.length = 0; });
  const tok = (u: { email: string; password: string }) => login(app, u.email, u.password).then((r) => r.accessToken);
  const list = (token: string) => app.inject({ method: 'GET', url: '/api/v1/me/notifications', headers: bearer(token) }).then((r) => r.json());

  it('notifies the first approver and backup on submit (in-app + email)', async () => {
    const s = await submittedSheet(app, db, (e, p) => login(app, e, p));
    await flush();
    const tl = await list(await tok(s.tl));
    expect(tl.meta.unread).toBe(1); expect(tl.data[0]).toMatchObject({ type: 'sheet.submitted', link: `/approvals/${s.sheetId}` });
    expect((await list(await tok(s.dm))).meta.unread).toBe(1);
    expect((await list(await tok(s.cto))).meta.unread).toBe(0);
    expect(mail.sent.map((m) => m.to).sort()).toEqual([s.dm.email, s.tl.email].sort());
  });

  it('step approval notifies employee (in-app) and next approver (both); final approval notifies employee and finance', async () => {
    const s = await submittedSheet(app, db, (e, p) => login(app, e, p));
    const fin = await createUser(db, { role: 'finance' });
    await flush(); mail.sent.length = 0;
    await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.sheetId}/approve`, headers: bearer(await tok(s.tl)), payload: { version: 2 } });
    await flush();
    expect((await list(s.empToken)).data[0].type).toBe('sheet.step_approved');
    expect(mail.sent.map((m) => m.to)).toEqual([s.dm.email]);
    await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.sheetId}/approve`, headers: bearer(await tok(s.dm)), payload: { version: 3 } });
    await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.sheetId}/approve`, headers: bearer(await tok(s.cto)), payload: { version: 4 } });
    await flush();
    expect((await list(s.empToken)).data[0].type).toBe('sheet.approved');
    expect((await list(await tok(fin))).data[0].type).toBe('sheet.approved');
    expect(mail.sent.at(-1)?.to).toBe(s.emp.email);
  });

  it('rejection email carries the reason; mark read and read-all work', async () => {
    const s = await submittedSheet(app, db, (e, p) => login(app, e, p));
    await flush(); mail.sent.length = 0;
    await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.sheetId}/reject`, headers: bearer(await tok(s.tl)), payload: { version: 2, reason: 'Missing links' } });
    await flush();
    expect(mail.sent[0].to).toBe(s.emp.email); expect(mail.sent[0].html).toContain('Missing links');
    const mine = await list(s.empToken);
    await app.inject({ method: 'POST', url: `/api/v1/me/notifications/${mine.data[0].id}/read`, headers: bearer(s.empToken) });
    expect((await list(s.empToken)).meta.unread).toBe(0);
    await app.inject({ method: 'POST', url: `/api/v1/me/notifications/read-all`, headers: bearer(await tok(s.tl)) });
    expect((await list(await tok(s.tl))).meta.unread).toBe(0);
  });

  it('monthly reminder targets employees with a non-empty draft for the previous month', async () => {
    const team = await createTeam(db); const type = await createOvertimeType(db);
    const withDraft = await createUser(db, { teamId: team.id }); const sheet = await createSheet(db, withDraft.id, '2026-09'); await createEntry(db, sheet.id, type.id);
    const emptyDraft = await createUser(db, { teamId: team.id }); await createSheet(db, emptyDraft.id, '2026-09');
    await app.get(ReminderService).runMonthlyReminder(new Date('2026-10-01T08:00:00Z'));
    expect(mail.sent.map((m) => m.to)).toEqual([withDraft.email]);
    expect((await list(await tok(withDraft))).data[0].type).toBe('sheet.reminder');
    mail.sent.length = 0;
    await app.get(ReminderService).runMonthlyReminder(new Date('2026-10-02T08:00:00Z'));
    expect(mail.sent).toHaveLength(0); // not the reminder day
  });
});
