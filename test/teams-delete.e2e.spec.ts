import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam, createChain, createSheet } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { approvalChainSteps, teams, users } from '@/database/schema';

describe('delete teams', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let adminToken: string;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); const a = await createUser(db, { role: 'admin' }); adminToken = (await login(app, a.email, a.password)).accessToken; });
  const del = (id: string) => app.inject({ method: 'DELETE', url: `/api/v1/teams/${id}`, headers: bearer(adminToken) });

  it('deletes an empty team and its chain', async () => {
    const lead = await createUser(db); const t = await createTeam(db);
    await createChain(db, t.id, [{ label: 'TL', approverId: lead.id }]);
    expect((await del(t.id)).statusCode).toBe(204);
    expect(await db.select().from(teams).where(eq(teams.id, t.id))).toHaveLength(0);
    expect(await db.select().from(approvalChainSteps).where(eq(approvalChainSteps.teamId, t.id))).toHaveLength(0);
  });

  it('refuses when a member exists', async () => {
    const t = await createTeam(db); await createUser(db, { teamId: t.id });
    const r = await del(t.id); expect(r.statusCode).toBe(409); expect(r.json().code).toBe('TEAM_IN_USE');
  });

  it('refuses when only a sheet snapshot references the team', async () => {
    const t = await createTeam(db); const emp = await createUser(db, { teamId: t.id });
    await createSheet(db, emp.id); await db.update(users).set({ teamId: null }).where(eq(users.id, emp.id));
    expect((await del(t.id)).json().code).toBe('TEAM_IN_USE');
  });

  it('404 for unknown and 403 for non-admin', async () => {
    expect((await del('00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);
    const emp = await createUser(db); const token = (await login(app, emp.email, emp.password)).accessToken; const t = await createTeam(db);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/teams/${t.id}`, headers: bearer(token) })).statusCode).toBe(403);
  });
});
