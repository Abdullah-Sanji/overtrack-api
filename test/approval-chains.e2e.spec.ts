import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

describe('approval chains', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let adminToken: string; let team: Awaited<ReturnType<typeof createTeam>>;
  let tl: Awaited<ReturnType<typeof createUser>>; let dm: Awaited<ReturnType<typeof createUser>>; let cto: Awaited<ReturnType<typeof createUser>>;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await truncateAll(db);
    const admin = await createUser(db, { role: 'admin' }); adminToken = (await login(app, admin.email, admin.password)).accessToken;
    team = await createTeam(db); tl = await createUser(db, { role: 'tech_lead' }); dm = await createUser(db, { role: 'delivery_manager' }); cto = await createUser(db, { role: 'cto' });
  });

  it('replaces the chain and returns it ordered with approver details', async () => {
    const put = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/chain`, headers: bearer(adminToken),
      payload: { steps: [{ label: 'Tech Lead', approverId: tl.id, backupApproverId: dm.id }, { label: 'Delivery Manager', approverId: dm.id }, { label: 'CTO', approverId: cto.id }] } });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.map((s: { position: number; label: string }) => [s.position, s.label])).toEqual([[1, 'Tech Lead'], [2, 'Delivery Manager'], [3, 'CTO']]);
    expect(put.json().data[0].backupApprover.id).toBe(dm.id);
    const again = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/chain`, headers: bearer(adminToken), payload: { steps: [{ label: 'CTO', approverId: cto.id }] } });
    expect(again.json().data).toHaveLength(1);
    const get = await app.inject({ method: 'GET', url: `/api/v1/teams/${team.id}/chain`, headers: bearer(adminToken) });
    expect(get.json().data).toHaveLength(1);
  });

  it('allows an empty chain (clears it) and rejects inactive approvers', async () => {
    const inactive = await createUser(db, { isActive: false });
    const bad = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/chain`, headers: bearer(adminToken), payload: { steps: [{ label: 'X', approverId: inactive.id }] } });
    expect(bad.json().code).toBe('CHAIN_APPROVER_INACTIVE');
    const empty = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/chain`, headers: bearer(adminToken), payload: { steps: [] } });
    expect(empty.statusCode).toBe(200); expect(empty.json().data).toEqual([]);
  });

  it('writes a chain.replaced audit entry', async () => {
    await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/chain`, headers: bearer(adminToken), payload: { steps: [{ label: 'TL', approverId: tl.id }] } });
    const audit = await app.inject({ method: 'GET', url: `/api/v1/admin/audit?entityType=chain&entityId=${team.id}`, headers: bearer(adminToken) });
    expect(audit.json().data[0].action).toBe('chain.replaced');
    expect(audit.json().data[0].after).toHaveLength(1);
  });
});
