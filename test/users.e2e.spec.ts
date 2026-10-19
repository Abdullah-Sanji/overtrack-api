import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam } from './helpers/factories';
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

  it('admin creates a user, which sends an invite that can be accepted', async () => {
    const team = await createTeam(db);
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: bearer(adminToken),
      payload: { firstName: 'Nora', lastName: 'K', email: 'Nora@T.local', role: 'employee', teamId: team.id, employeeCode: 'E42' } });
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
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: bearer(adminToken), payload: { firstName: 'A', lastName: 'B', email: 'dup@t.local', role: 'employee' } });
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
      payload: { firstName: 'Lost', lastName: 'T', email: 'lost@t.local', role: 'employee', teamId: randomUUID() } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});
