import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam, systemRoleId } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { MailService } from '@/mail/mail.service';

describe('users', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let mail: MailService;
  let admin: Awaited<ReturnType<typeof createUser>>; let adminToken: string;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; mail = app.get(MailService); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await truncateAll(db); mail.sent.length = 0;
    admin = await createUser(db, { role: 'admin', email: 'admin@t.local' });
    adminToken = (await login(app, admin.email, admin.password)).accessToken;
  });

  it('an admin cannot demote themselves through PATCH, but can change others', async () => {
    const employeeRole = await systemRoleId(db, 'employee'); const other = await createUser(db, { role: 'tech_lead' });
    const self = await app.inject({ method: 'PATCH', url: `/api/v1/users/${admin.id}`, headers: bearer(adminToken), payload: { roleId: employeeRole } });
    expect(self.statusCode).toBe(409); expect(self.json().code).toBe('CANNOT_DEMOTE_SELF');
    const ok = await app.inject({ method: 'PATCH', url: `/api/v1/users/${other.id}`, headers: bearer(adminToken), payload: { roleId: employeeRole } });
    expect(ok.statusCode).toBe(200);
  });

  it('admin creates a user, which sends an invite that can be accepted', async () => {
    const team = await createTeam(db);
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: bearer(adminToken),
      payload: { firstName: 'Nora', lastName: 'K', email: 'Nora@T.local', roleId: await systemRoleId(db, 'employee'), teamId: team.id, employeeCode: 'E42' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.email).toBe('nora@t.local');
    expect(mail.sent).toHaveLength(1);
    const token = mail.sent[0].html.match(/accept-invite\?token=([a-f0-9]+)/)![1];
    const accept = await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { token, password: 'NewPassword123' } });
    expect(accept.statusCode).toBe(204);
    const l = await login(app, 'nora@t.local', 'NewPassword123');
    expect(l.accessToken).toBeTypeOf('string');
    const reuse = await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { token, password: 'NewPassword123' } });
    expect(reuse.json().code).toBe('TOKEN_INVALID');
  });

  it('rejects duplicate email with EMAIL_TAKEN', async () => {
    await createUser(db, { email: 'dup@t.local' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: bearer(adminToken), payload: { firstName: 'A', lastName: 'B', email: 'dup@t.local', roleId: await systemRoleId(db, 'employee') } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('EMAIL_TAKEN');
  });

  it('lists with search and filters, paginated', async () => {
    const team = await createTeam(db);
    for (let i = 0; i < 25; i++) await createUser(db, { firstName: i < 3 ? 'Zed' : 'Al', teamId: team.id });
    const res = await app.inject({ method: 'GET', url: '/api/v1/users?search=zed&pageSize=2', headers: bearer(adminToken) });
    expect(res.json().meta).toEqual({ page: 1, pageSize: 2, total: 3 });
    expect(res.json().data).toHaveLength(2);
    expect(res.json().data[0]).not.toHaveProperty('passwordHash');
  });

  it('deactivate blocks login; reactivate restores it', async () => {
    const u = await createUser(db);
    const sess = await login(app, u.email, u.password);
    await app.inject({ method: 'POST', url: `/api/v1/users/${u.id}/deactivate`, headers: bearer(adminToken) });
    const l = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: u.email, password: u.password } });
    expect(l.json().code).toBe('USER_INACTIVE');
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: sess.cookie } })).statusCode).toBe(401);
    await app.inject({ method: 'POST', url: `/api/v1/users/${u.id}/reactivate`, headers: bearer(adminToken) });
    expect((await login(app, u.email, u.password)).accessToken).toBeTypeOf('string');
  });

  it('forgot password emails a reset link that works once', async () => {
    const u = await createUser(db);
    const old = await login(app, u.email, u.password);
    const f = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: u.email } });
    expect(f.statusCode).toBe(204);
    const token = mail.sent[0].html.match(/reset-password\?token=([a-f0-9]+)/)![1];
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'AnotherPass123' } });
    expect(r.statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: old.cookie } })).statusCode).toBe(401);
    expect((await login(app, u.email, 'AnotherPass123')).accessToken).toBeTypeOf('string');
    // unknown email still 204, no email
    mail.sent.length = 0;
    await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: 'ghost@t.local' } });
    expect(mail.sent).toHaveLength(0);
  });

  it('me: update profile and change password', async () => {
    const u = await createUser(db);
    const { accessToken, cookie } = await login(app, u.email, u.password);
    const p = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers: bearer(accessToken), payload: { timezone: 'Europe/Berlin' } });
    expect(p.json().data.timezone).toBe('Europe/Berlin');
    const bad = await app.inject({ method: 'POST', url: '/api/v1/me/change-password', headers: bearer(accessToken), payload: { currentPassword: 'nope-nope-nope', newPassword: 'FreshPass1234' } });
    expect(bad.json().code).toBe('INVALID_CREDENTIALS');
    const ok = await app.inject({ method: 'POST', url: '/api/v1/me/change-password', headers: bearer(accessToken), payload: { currentPassword: u.password, newPassword: 'FreshPass1234' } });
    expect(ok.statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie } })).statusCode).toBe(401);
  });

  it('returns 404 NOT_FOUND when the team does not exist', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: bearer(adminToken),
      payload: { firstName: 'Lost', lastName: 'T', email: 'lost@t.local', roleId: await systemRoleId(db, 'employee'), teamId: randomUUID() } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  describe('directory', () => {
    it('employee gets name-only list of active users; admin is not shadowed by :id', async () => {
      const emp = await createUser(db, { firstName: 'Emp', lastName: 'Zed' });
      const mgr = await createUser(db, { firstName: 'Mia', lastName: 'Boss', role: 'delivery_manager' });
      const gone = await createUser(db, { firstName: 'Gone', lastName: 'Away', isActive: false });
      const empToken = (await login(app, emp.email, emp.password)).accessToken;
      const res = await app.inject({ method: 'GET', url: '/api/v1/users/directory', headers: bearer(empToken) });
      expect(res.statusCode).toBe(200);
      const data = res.json().data as Array<Record<string, unknown>>;
      expect(data.map((u) => u.id).sort()).toEqual([admin.id, emp.id, mgr.id].sort());
      expect(data.map((u) => u.id)).not.toContain(gone.id);
      for (const u of data) expect(Object.keys(u).sort()).toEqual(['firstName', 'id', 'lastName', 'role', 'teamId']);
      expect(data.find((u) => u.id === mgr.id)).toMatchObject({ firstName: 'Mia', lastName: 'Boss', role: { name: 'Delivery Manager', level: 'manager' }, teamId: null });
      const adminRes = await app.inject({ method: 'GET', url: '/api/v1/users/directory', headers: bearer(adminToken) });
      expect(adminRes.statusCode).toBe(200);
      expect(adminRes.json().data).toHaveLength(3);
    });

    it('filters by search on first or last name', async () => {
      const emp = await createUser(db);
      await createUser(db, { firstName: 'Mia', lastName: 'Boss' });
      await createUser(db, { firstName: 'Bob', lastName: 'Miller' });
      const empToken = (await login(app, emp.email, emp.password)).accessToken;
      const res = await app.inject({ method: 'GET', url: '/api/v1/users/directory?search=mi', headers: bearer(empToken) });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.map((u: { lastName: string }) => u.lastName)).toEqual(['Boss', 'Miller']);
    });
  });
});
