import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, submittedSheet } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

describe('inbox', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); });
  const tok = (u: { email: string; password: string }) => login(app, u.email, u.password).then((r) => r.accessToken);
  const inbox = (token: string, scope: string) => app.inject({ method: 'GET', url: `/api/v1/approvals/inbox?scope=${scope}`, headers: bearer(token) }).then((r) => r.json());

  it('shows waiting for the current approver and its backup, upcoming for later approvers', async () => {
    const s = await submittedSheet(app, db, (e, p) => login(app, e, p));
    const tl = await inbox(await tok(s.tl), 'waiting');
    expect(tl.meta.total).toBe(1); expect(tl.data[0]).toMatchObject({ id: s.sheetId, step: { position: 1, label: 'Tech Lead', status: 'pending' } });
    expect((await inbox(await tok(s.dm), 'waiting')).meta.total).toBe(1); // backup on step 1
    expect((await inbox(await tok(s.cto), 'waiting')).meta.total).toBe(0);
    expect((await inbox(await tok(s.cto), 'upcoming')).meta.total).toBe(1);
    expect((await inbox(s.empToken, 'waiting')).meta.total).toBe(0);
  });

  it('moves to decided after acting; admin sees all submitted sheets as waiting', async () => {
    const s = await submittedSheet(app, db, (e, p) => login(app, e, p));
    await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.sheetId}/approve`, headers: bearer(await tok(s.tl)), payload: { version: 2 } });
    expect((await inbox(await tok(s.tl), 'waiting')).meta.total).toBe(0);
    const decided = await inbox(await tok(s.tl), 'decided');
    expect(decided.data[0].step).toMatchObject({ position: 1, status: 'approved' });
    expect((await inbox(await tok(s.dm), 'waiting')).data[0].step.position).toBe(2);
    const admin = await createUser(db, { role: 'admin' });
    expect((await inbox(await tok(admin), 'waiting')).meta.total).toBe(1);
  });
});
