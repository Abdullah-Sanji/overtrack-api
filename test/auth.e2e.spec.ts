import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

describe('auth', () => {
  let app: NestFastifyApplication;
  let db: DrizzleService['db'];
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); });

  it('logs in with valid credentials and sets the refresh cookie', async () => {
    const u = await createUser(db, { email: 'a@t.local', password: 'Password123!' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'a@t.local', password: 'Password123!' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user).toMatchObject({ id: u.id, email: 'a@t.local', role: 'employee' });
    expect(res.json().data.accessToken).toBeTypeOf('string');
    const cookie = res.cookies.find((c) => c.name === 'ot_refresh');
    expect(cookie?.httpOnly).toBe(true);
  });

  it('rejects bad password with INVALID_CREDENTIALS', async () => {
    await createUser(db, { email: 'a@t.local' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'a@t.local', password: 'wrong-password' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects inactive users with USER_INACTIVE', async () => {
    const u = await createUser(db, { isActive: false });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: u.email, password: u.password } });
    expect(res.json().code).toBe('USER_INACTIVE');
  });

  it('protects routes and exposes /me', async () => {
    const u = await createUser(db);
    expect((await app.inject({ method: 'GET', url: '/api/v1/me' })).statusCode).toBe(401);
    const { accessToken } = await login(app, u.email, u.password);
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(u.id);
  });

  it('rotates the refresh token and revokes the family on reuse', async () => {
    const u = await createUser(db);
    const { cookie } = await login(app, u.email, u.password);
    const first = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie } });
    expect(first.statusCode).toBe(200);
    const second = res2cookie(first);
    // replay the original cookie
    const replay = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie } });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe('TOKEN_REUSED');
    // the rotated token is now dead too
    const after = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: second } });
    expect(after.statusCode).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const u = await createUser(db);
    const { cookie, accessToken } = await login(app, u.email, u.password);
    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie, ...bearer(accessToken) } });
    expect(out.statusCode).toBe(204);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });

  it('rate-limits auth routes to 10 requests per minute', async () => {
    const attempt = () => app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.0.0.1', payload: { email: 'nobody@t.local', password: 'wrong-password' } });
    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
  });

  // Un-skip in Task 5 once GET /users exists.
  it.skip('enforces @Roles on admin routes', async () => {
    const u = await createUser(db, { role: 'employee' });
    const { accessToken } = await login(app, u.email, u.password);
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: bearer(accessToken) });
    expect(res.statusCode).toBe(403);
  });
});

function res2cookie(res: { cookies: Array<{ name: string; value: string }> }) {
  const c = res.cookies.find((x) => x.name === 'ot_refresh')!;
  return `${c.name}=${c.value}`;
}
