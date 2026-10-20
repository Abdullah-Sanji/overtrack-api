import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam, createChain, createSheet, createEntry, createOvertimeType } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { attachments, auditLog, notifications, sheetApprovalSteps, sheetEntries, sheets, users } from '@/database/schema';

describe('delete users', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let adminToken: string; let admin: Awaited<ReturnType<typeof createUser>>;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); admin = await createUser(db, { role: 'admin' }); adminToken = (await login(app, admin.email, admin.password)).accessToken; });
  const del = (id: string) => app.inject({ method: 'DELETE', url: `/api/v1/users/${id}`, headers: bearer(adminToken) });

  it('deletes a fresh user and cascades notifications; audit keeps the email', async () => {
    const u = await createUser(db, { email: 'fresh@t.local' });
    await db.insert(notifications).values({ userId: u.id, type: 'sheet.submitted', title: 't', body: 'b', link: '/x' });
    expect((await del(u.id)).statusCode).toBe(204);
    expect(await db.select().from(users).where(eq(users.id, u.id))).toHaveLength(0);
    expect(await db.select().from(notifications).where(eq(notifications.userId, u.id))).toHaveLength(0);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.entityId, u.id));
    expect(entry.action).toBe('user.deleted');
    expect((entry.before as { email: string }).email).toBe('fresh@t.local');
  });

  it('refuses self-delete and unknown ids', async () => {
    expect((await del(admin.id)).json().code).toBe('CANNOT_DELETE_SELF');
    expect((await del('00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);
  });

  const expectHistory = async (id: string) => { const r = await del(id); expect(r.statusCode).toBe(409); expect(r.json().code).toBe('USER_HAS_HISTORY'); };

  it('refuses when the user owns a sheet', async () => { const u = await createUser(db); await createSheet(db, u.id); await expectHistory(u.id); });
  it('refuses when the user is a backup approver on a chain', async () => {
    const lead = await createUser(db); const backup = await createUser(db); const t = await createTeam(db);
    await createChain(db, t.id, [{ label: 'TL', approverId: lead.id, backupApproverId: backup.id }]);
    await expectHistory(backup.id);
  });
  it('refuses when the user decided a step', async () => {
    const emp = await createUser(db); const sheet = await createSheet(db, emp.id); const approver = await createUser(db); const decider = await createUser(db);
    await db.insert(sheetApprovalSteps).values({ sheetId: sheet.id, round: 1, position: 1, label: 'TL', approverId: approver.id, status: 'approved', decidedById: decider.id, decidedAt: new Date() });
    await expectHistory(decider.id);
  });
  it('refuses when the user is a tech lead', async () => { const lead = await createUser(db); await createTeam(db, { techLeadId: lead.id }); await expectHistory(lead.id); });
  it('refuses when the user requested an entry', async () => {
    const emp = await createUser(db); const mgr = await createUser(db); const type = await createOvertimeType(db); const sheet = await createSheet(db, emp.id);
    const e = await createEntry(db, sheet.id, type.id); await db.update(sheetEntries).set({ requestedById: mgr.id }).where(eq(sheetEntries.id, e.id));
    await expectHistory(mgr.id);
  });
  it('refuses when the user has audit entries as actor', async () => {
    const other = await createUser(db, { role: 'admin' }); const token = (await login(app, other.email, other.password)).accessToken;
    await app.inject({ method: 'POST', url: '/api/v1/teams', headers: bearer(token), payload: { name: 'Audit team' } });
    await expectHistory(other.id);
  });
  it('refuses when the user paid a sheet', async () => {
    const emp = await createUser(db); const payer = await createUser(db); const s = await createSheet(db, emp.id);
    await db.update(sheets).set({ paidById: payer.id }).where(eq(sheets.id, s.id));
    await expectHistory(payer.id);
  });
  it('refuses when the user owns an attachment', async () => {
    const u = await createUser(db);
    await db.insert(attachments).values({ ownerId: u.id, storageKey: 'k/1', originalName: 'a.png', mimeType: 'image/png', sizeBytes: 1 });
    await expectHistory(u.id);
  });
  it('refuses when the user is the primary approver on a sheet step', async () => {
    const emp = await createUser(db); const sheet = await createSheet(db, emp.id); const approver = await createUser(db);
    await db.insert(sheetApprovalSteps).values({ sheetId: sheet.id, round: 1, position: 1, label: 'TL', approverId: approver.id });
    await expectHistory(approver.id);
  });
  it('refuses when the user is the backup approver on a sheet step', async () => {
    const emp = await createUser(db); const sheet = await createSheet(db, emp.id); const approver = await createUser(db); const backup = await createUser(db);
    await db.insert(sheetApprovalSteps).values({ sheetId: sheet.id, round: 1, position: 1, label: 'TL', approverId: approver.id, backupApproverId: backup.id });
    await expectHistory(backup.id);
  });
  it('refuses when the user is the primary approver on a chain step', async () => {
    const lead = await createUser(db); const t = await createTeam(db);
    await createChain(db, t.id, [{ label: 'TL', approverId: lead.id }]);
    await expectHistory(lead.id);
  });
  it('non-admins get 403', async () => {
    const emp = await createUser(db); const token = (await login(app, emp.email, emp.password)).accessToken; const victim = await createUser(db);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/users/${victim.id}`, headers: bearer(token) })).statusCode).toBe(403);
  });
});
