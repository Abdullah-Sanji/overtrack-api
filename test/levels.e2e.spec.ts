import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createRole } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { users } from '@/database/schema';

describe('role levels', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); });

  it('a custom role with level admin reaches admin routes; level employee does not', async () => {
    const custom = await createRole(db, { name: 'Ops Admin', level: 'admin' });
    const u = await createUser(db, { roleId: custom.id });
    const token = (await login(app, u.email, u.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: bearer(token) })).statusCode).toBe(200);
    const emp = await createUser(db);
    const t2 = (await login(app, emp.email, emp.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: bearer(t2) })).statusCode).toBe(403);
  });

  it('a level change applies after re-login', async () => {
    const r = await createRole(db, { name: 'Shifting', level: 'admin' });
    const u = await createUser(db, { roleId: r.id });
    const t1 = (await login(app, u.email, u.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: bearer(t1) })).statusCode).toBe(200);
    const employeeRole = await createRole(db, { name: 'Plain', level: 'employee' });
    await db.update(users).set({ roleId: employeeRole.id }).where(eq(users.id, u.id));
    const t2 = (await login(app, u.email, u.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: bearer(t2) })).statusCode).toBe(403);
  });

  it('ignores role claims in the token and reads the role from the database', async () => {
    const u = await createUser(db, { role: 'employee' });
    const forged = await app.get(JwtService).signAsync({ sub: u.id, role: 'admin', level: 'admin', teamId: null }, { expiresIn: 900 });
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: bearer(forged) });
    expect(res.statusCode).toBe(403);
  });

  it('/me returns the role object', async () => {
    const u = await createUser(db, { role: 'finance' });
    const token = (await login(app, u.email, u.password)).accessToken;
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(token) });
    expect(res.json().data.role).toMatchObject({ name: 'Finance', level: 'finance' });
    expect(res.json().data).not.toHaveProperty('roleId');
  });
});
