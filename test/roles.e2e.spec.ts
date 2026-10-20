import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createRole, systemRoleId } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { auditLog, roles } from '@/database/schema';
import { RolesService } from '@/roles/roles.service';
import { createAdmin } from '@/database/create-admin';

describe('roles', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let adminToken: string; let admin: Awaited<ReturnType<typeof createUser>>;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await truncateAll(db);
    admin = await createUser(db, { role: 'admin' }); adminToken = (await login(app, admin.email, admin.password)).accessToken;
  });
  const post = (payload: unknown, token = adminToken) => app.inject({ method: 'POST', url: '/api/v1/roles', headers: bearer(token), payload });

  it('lists the six system roles with user counts for any signed-in user', async () => {
    const emp = await createUser(db); const token = (await login(app, emp.email, emp.password)).accessToken;
    const res = await app.inject({ method: 'GET', url: '/api/v1/roles', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const names = res.json().data.map((r: { name: string }) => r.name);
    expect(names).toEqual(['Admin', 'CTO', 'Delivery Manager', 'Employee', 'Finance', 'Tech Lead']);
    expect(res.json().data.find((r: { name: string }) => r.name === 'Employee')).toMatchObject({ level: 'employee', isSystem: true, userCount: 1 });
  });

  it('admin creates, renames and deletes a custom role with audit entries', async () => {
    const created = await post({ name: 'QA Lead', level: 'manager' });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ name: 'QA Lead', level: 'manager', isSystem: false, userCount: 0 });
    const id = created.json().data.id;
    const renamed = await app.inject({ method: 'PATCH', url: `/api/v1/roles/${id}`, headers: bearer(adminToken), payload: { name: 'QA Manager', level: 'finance' } });
    expect(renamed.json().data).toMatchObject({ name: 'QA Manager', level: 'finance' });
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/roles/${id}`, headers: bearer(adminToken) })).statusCode).toBe(204);
    const actions = (await db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, id))).map((r) => r.a).sort();
    expect(actions).toEqual(['role.created', 'role.deleted', 'role.updated']);
  });

  it('rejects names that differ only by case', async () => {
    const res = await post({ name: 'admin', level: 'employee' });
    expect(res.statusCode).toBe(409); expect(res.json().code).toBe('ROLE_NAME_TAKEN');
  });

  it('system roles can be renamed but not re-levelled or deleted', async () => {
    const adminRoleId = await systemRoleId(db, 'admin');
    const ok = await app.inject({ method: 'PATCH', url: `/api/v1/roles/${adminRoleId}`, headers: bearer(adminToken), payload: { name: 'Administrator' } });
    expect(ok.statusCode).toBe(200);
    const level = await app.inject({ method: 'PATCH', url: `/api/v1/roles/${adminRoleId}`, headers: bearer(adminToken), payload: { level: 'employee' } });
    expect(level.json().code).toBe('ROLE_IS_SYSTEM');
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/roles/${adminRoleId}`, headers: bearer(adminToken) });
    expect(del.json().code).toBe('ROLE_IS_SYSTEM');
  });

  it('renaming a system role survives restarts', async () => {
    const adminRoleId = await systemRoleId(db, 'admin');
    const ok = await app.inject({ method: 'PATCH', url: `/api/v1/roles/${adminRoleId}`, headers: bearer(adminToken), payload: { name: 'Administrator' } });
    expect(ok.statusCode).toBe(200);
    const svc = app.get(RolesService); await svc.ensureSystemRoles(); await svc.ensureSystemRoles();
    const sys = await db.select().from(roles).where(eq(roles.isSystem, true));
    expect(sys).toHaveLength(6);
    expect(sys.some((r) => r.name === 'Admin')).toBe(false);
    expect(await createAdmin(app, { email: 'second@t.local', password: 'LongPassword123', firstName: 'Sec', lastName: 'Ond' })).toBe('created');
  });

  it('a role with users cannot be deleted', async () => {
    const r = await createRole(db, { name: 'Temp', level: 'employee' });
    await createUser(db, { roleId: r.id });
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/roles/${r.id}`, headers: bearer(adminToken) });
    expect(del.statusCode).toBe(409); expect(del.json().code).toBe('ROLE_IN_USE');
  });

  it('an admin cannot demote their own custom role', async () => {
    const r = await createRole(db, { name: 'Super', level: 'admin' });
    const me = await createUser(db, { roleId: r.id }); const token = (await login(app, me.email, me.password)).accessToken;
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/roles/${r.id}`, headers: bearer(token), payload: { level: 'manager' } });
    expect(res.json().code).toBe('CANNOT_DEMOTE_SELF');
  });

  it('non-admins cannot create roles', async () => {
    const emp = await createUser(db); const token = (await login(app, emp.email, emp.password)).accessToken;
    expect((await post({ name: 'X', level: 'employee' }, token)).statusCode).toBe(403);
  });
});
