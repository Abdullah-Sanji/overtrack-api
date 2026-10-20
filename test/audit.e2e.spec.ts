import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, systemRoleId } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

describe('audit', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let admin: Awaited<ReturnType<typeof createUser>>; let adminToken: string;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); admin = await createUser(db, { role: 'admin' }); adminToken = (await login(app, admin.email, admin.password)).accessToken; });

  it('records admin config changes with actor, before and after', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/v1/teams', headers: bearer(adminToken), payload: { name: 'Ops' } });
    const id = c.json().data.id;
    await app.inject({ method: 'PATCH', url: `/api/v1/teams/${id}`, headers: bearer(adminToken), payload: { name: 'Operations' } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/admin/audit?entityType=team&entityId=${id}`, headers: bearer(adminToken) });
    expect(res.statusCode).toBe(200);
    const actions = res.json().data.map((r: { action: string }) => r.action);
    expect(actions).toEqual(['team.updated', 'team.created']);
    const updated = res.json().data[0];
    expect(updated.actor.id).toBe(admin.id);
    expect(updated.before.name).toBe('Ops');
    expect(updated.after.name).toBe('Operations');
  });

  it('audits user and overtime type changes without leaking password hashes', async () => {
    const u = await app.inject({ method: 'POST', url: '/api/v1/users', headers: bearer(adminToken), payload: { firstName: 'Nora', lastName: 'K', email: 'nora@t.local', roleId: await systemRoleId(db, 'employee') } });
    const uid = u.json().data.id;
    await app.inject({ method: 'POST', url: `/api/v1/users/${uid}/deactivate`, headers: bearer(adminToken) });
    await app.inject({ method: 'POST', url: `/api/v1/users/${uid}/reactivate`, headers: bearer(adminToken) });
    const t = await app.inject({ method: 'POST', url: '/api/v1/overtime-types', headers: bearer(adminToken), payload: { name: 'Night', multiplier: 1.5 } });
    await app.inject({ method: 'PATCH', url: `/api/v1/overtime-types/${t.json().data.id}`, headers: bearer(adminToken), payload: { color: '#000000' } });
    const ur = await app.inject({ method: 'GET', url: `/api/v1/admin/audit?entityType=user&entityId=${uid}`, headers: bearer(adminToken) });
    expect(ur.json().data.map((r: { action: string }) => r.action)).toEqual(['user.reactivated', 'user.deactivated', 'user.created']);
    expect(JSON.stringify(ur.json())).not.toContain('passwordHash');
    const tr = await app.inject({ method: 'GET', url: '/api/v1/admin/audit?entityType=overtime_type', headers: bearer(adminToken) });
    expect(tr.json().data.map((r: { action: string }) => r.action)).toEqual(['overtime_type.updated', 'overtime_type.created']);
  });

  it('is admin-only', async () => {
    const e = await createUser(db); const t = (await login(app, e.email, e.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/audit', headers: bearer(t) })).statusCode).toBe(403);
  });
});
