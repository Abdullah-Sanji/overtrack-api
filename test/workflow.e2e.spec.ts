import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam, createChain, createOvertimeType, createSheet, createEntry, submittedSheet } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { overtimeTypes, sheetEntries } from '@/database/schema';

describe('workflow', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); });
  const act = (token: string, id: string, action: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/api/v1/sheets/${id}/${action}`, headers: bearer(token), payload });
  const tok = (u: { email: string; password: string }) => login(app, u.email, u.password).then((r) => r.accessToken);
  const loginFn = (e: string, p: string) => login(app, e, p);

  it('runs the happy path: submit → TL → DM → CTO → paid, with version bumps and timeline', async () => {
    const s = await submittedSheet(app, db, loginFn);
    expect(s.version).toBe(2);
    const r1 = await act(await tok(s.tl), s.sheetId, 'approve', { version: 2, comment: 'fine' });
    expect(r1.statusCode).toBe(200); expect(r1.json().data).toMatchObject({ status: 'submitted', currentStepPosition: 2, version: 3 });
    const r2 = await act(await tok(s.dm), s.sheetId, 'approve', { version: 3 });
    expect(r2.json().data.currentStepPosition).toBe(3);
    const r3 = await act(await tok(s.cto), s.sheetId, 'approve', { version: 4 });
    expect(r3.json().data).toMatchObject({ status: 'approved', currentStepPosition: null });
    const fin = await createUser(db, { role: 'finance' });
    const paid = await act(await tok(fin), s.sheetId, 'mark-paid', { version: 5, paymentReference: 'PAY-2026-09' });
    expect(paid.json().data).toMatchObject({ status: 'paid', paymentReference: 'PAY-2026-09' });
    const tl = await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.sheetId}/timeline`, headers: bearer(s.empToken) });
    expect(tl.json().data.audit.map((a: { action: string }) => a.action)).toEqual(['sheet.submitted', 'sheet.step_approved', 'sheet.step_approved', 'sheet.approved', 'sheet.paid']);
    expect(tl.json().data.rounds[0].steps.map((x: { status: string }) => x.status)).toEqual(['approved', 'approved', 'approved']);
  });

  it('rejects a stale version with 409 SHEET_VERSION_CONFLICT (two approvers racing)', async () => {
    const s = await submittedSheet(app, db, loginFn);
    const first = await act(await tok(s.tl), s.sheetId, 'approve', { version: 2 });
    expect(first.statusCode).toBe(200);
    const second = await act(await tok(s.dm), s.sheetId, 'approve', { version: 2 }); // dm is backup of step 1, uses stale version
    expect(second.statusCode).toBe(409); expect(second.json().code).toBe('SHEET_VERSION_CONFLICT');
    const detail = await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.sheetId}`, headers: bearer(s.empToken) });
    expect(detail.json().data.currentStepPosition).toBe(2);
  });

  it('keeps the snapshot when the team chain is edited mid-flight', async () => {
    const s = await submittedSheet(app, db, loginFn);
    const admin = await createUser(db, { role: 'admin' }); const at = await tok(admin);
    const newcomer = await createUser(db, { role: 'cto' });
    await app.inject({ method: 'PUT', url: `/api/v1/teams/${s.team.id}/chain`, headers: bearer(at), payload: { steps: [{ label: 'Only', approverId: newcomer.id }] } });
    const r = await act(await tok(newcomer), s.sheetId, 'approve', { version: 2 });
    expect(r.json().code).toBe('NOT_CURRENT_APPROVER');
    const ok = await act(await tok(s.tl), s.sheetId, 'approve', { version: 2 });
    expect(ok.json().data.currentStepPosition).toBe(2);
  });

  it('reject → employee edits → resubmit starts round 2; withdraw only before first approval', async () => {
    const s = await submittedSheet(app, db, loginFn);
    const rej = await act(await tok(s.tl), s.sheetId, 'reject', { version: 2, reason: 'Add ticket links' });
    expect(rej.json().data).toMatchObject({ status: 'rejected', rejectionReason: 'Add ticket links' });
    const edit = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.sheetId}/entries`, headers: bearer(s.empToken),
      payload: { date: '2026-09-12', startTime: '18:00', endTime: '19:00', overtimeTypeId: s.type.id, workItem: 'PROJ-3', description: 'Follow-up fixes done' } });
    expect(edit.statusCode).toBe(201);
    const re = await act(s.empToken, s.sheetId, 'submit', { version: 3 });
    expect(re.json().data).toMatchObject({ status: 'submitted', round: 2, currentStepPosition: 1 });
    const wd = await act(s.empToken, s.sheetId, 'withdraw', { version: 4 });
    expect(wd.json().data.status).toBe('draft');
    const tl = await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.sheetId}/timeline`, headers: bearer(s.empToken) });
    expect(tl.json().data.rounds.map((r: { round: number }) => r.round)).toEqual([1]); // round 2 steps deleted on withdraw
  });

  it('admin override needs a reason and is recorded; reopen; revert paid', async () => {
    const s = await submittedSheet(app, db, loginFn);
    const admin = await createUser(db, { role: 'admin' }); const at = await tok(admin);
    expect((await act(at, s.sheetId, 'approve', { version: 2 })).json().code).toBe('REASON_REQUIRED');
    for (const v of [2, 3, 4]) expect((await act(at, s.sheetId, 'approve', { version: v, overrideReason: 'Approvers on leave' })).statusCode).toBe(200);
    const detail = await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.sheetId}`, headers: bearer(at) });
    expect(detail.json().data.status).toBe('approved');
    expect(detail.json().data.steps.every((x: { overrideReason: string | null; decidedBy: { id: string } }) => x.overrideReason === 'Approvers on leave' && x.decidedBy.id === admin.id)).toBe(true);
    const paid = await act(at, s.sheetId, 'mark-paid', { version: 5, paymentReference: 'X' });
    expect(paid.json().data.status).toBe('paid');
    expect((await act(at, s.sheetId, 'reopen', { version: 6, reason: 'nope' })).json().code).toBe('INVALID_TRANSITION');
    const rev = await act(at, s.sheetId, 'revert-paid', { version: 6, reason: 'Wrong batch' });
    expect(rev.json().data.status).toBe('approved');
    const re = await act(at, s.sheetId, 'reopen', { version: 7, reason: 'Fix hours' });
    expect(re.json().data.status).toBe('draft');
  });

  it('submit fails without team or chain, re-snapshots multipliers, and bulk mark-paid reports per-sheet results', async () => {
    const noTeam = await createUser(db); const type = await createOvertimeType(db, { multiplier: '1.50' });
    const sh = await createSheet(db, noTeam.id); await createEntry(db, sh.id, type.id);
    expect((await act(await tok(noTeam), sh.id, 'submit', { version: 1 })).json().code).toBe('USER_HAS_NO_TEAM');
    const team = await createTeam(db); const inTeam = await createUser(db, { teamId: team.id });
    const sh2 = await createSheet(db, inTeam.id); await createEntry(db, sh2.id, type.id, { multiplier: '1.50' });
    expect((await act(await tok(inTeam), sh2.id, 'submit', { version: 1 })).json().code).toBe('CHAIN_EMPTY');
    const cto = await createUser(db, { role: 'cto' }); await createChain(db, team.id, [{ label: 'CTO', approverId: cto.id }]);
    await db.update(overtimeTypes).set({ multiplier: '2.00' }).where(eq(overtimeTypes.id, type.id));
    const sub = await act(await tok(inTeam), sh2.id, 'submit', { version: 1 });
    expect(sub.statusCode).toBe(200);
    const [entry] = await db.select().from(sheetEntries).where(eq(sheetEntries.sheetId, sh2.id));
    expect(entry.multiplierSnapshot).toBe('2.00'); expect(sub.json().data.totalWeightedHours).toBe(4);
    await act(await tok(cto), sh2.id, 'approve', { version: 2 });
    const fin = await createUser(db, { role: 'finance' });
    const bulk = await app.inject({ method: 'POST', url: '/api/v1/sheets/mark-paid', headers: bearer(await tok(fin)), payload: { sheets: [{ id: sh2.id, version: 3 }, { id: sh.id, version: 1 }], paymentReference: 'BATCH-1' } });
    expect(bulk.json().data).toEqual({ paid: [sh2.id], failed: [{ id: sh.id, code: 'INVALID_TRANSITION' }] });
  });
});
