import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { OvertimeTypesService } from '@/overtime-types/overtime-types.service';

describe('overtime types', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let adminToken: string; let empToken: string;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await truncateAll(db);
    const a = await createUser(db, { role: 'admin' }); adminToken = (await login(app, a.email, a.password)).accessToken;
    const e = await createUser(db); empToken = (await login(app, e.email, e.password)).accessToken;
  });

  it('ensureDefaults seeds four types once', async () => {
    const svc = app.get(OvertimeTypesService);
    await svc.ensureDefaults(); await svc.ensureDefaults();
    const res = await app.inject({ method: 'GET', url: '/api/v1/overtime-types', headers: bearer(empToken) });
    expect(res.json().data.map((t: { name: string; multiplier: number }) => [t.name, t.multiplier])).toEqual([
      ['Weekday extra hours', 1.5], ['Weekend', 2], ['Public holiday', 2.5], ['On-call / standby', 1],
    ]);
  });

  it('admin creates, updates, deactivates; inactive hidden by default', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/v1/overtime-types', headers: bearer(adminToken), payload: { name: 'Night shift', multiplier: 1.75, color: '#7C3AED' } });
    expect(c.statusCode).toBe(201);
    expect(c.json().data.multiplier).toBe(1.75);
    const id = c.json().data.id;
    await app.inject({ method: 'PATCH', url: `/api/v1/overtime-types/${id}`, headers: bearer(adminToken), payload: { isActive: false } });
    const visible = await app.inject({ method: 'GET', url: '/api/v1/overtime-types', headers: bearer(empToken) });
    expect(visible.json().data).toHaveLength(0);
    const all = await app.inject({ method: 'GET', url: '/api/v1/overtime-types?includeInactive=true', headers: bearer(adminToken) });
    expect(all.json().data).toHaveLength(1);
  });

  it('rejects a duplicate type name with 409', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/v1/overtime-types', headers: bearer(adminToken), payload: { name: 'Weekend', multiplier: 2 } });
    expect(first.statusCode).toBe(201);
    const dup = await app.inject({ method: 'POST', url: '/api/v1/overtime-types', headers: bearer(adminToken), payload: { name: 'Weekend', multiplier: 3 } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('CONFLICT');
  });

  it('rejects multiplier <= 0 and non-admin writes', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/v1/overtime-types', headers: bearer(adminToken), payload: { name: 'X', multiplier: 0 } });
    expect(bad.json().code).toBe('VALIDATION_FAILED');
    const forb = await app.inject({ method: 'POST', url: '/api/v1/overtime-types', headers: bearer(empToken), payload: { name: 'X', multiplier: 1 } });
    expect(forb.statusCode).toBe(403);
  });

  it('rejects renaming a type to an existing name with 409', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/overtime-types', headers: bearer(adminToken), payload: { name: 'Weekend', multiplier: 2 } });
    const other = await app.inject({ method: 'POST', url: '/api/v1/overtime-types', headers: bearer(adminToken), payload: { name: 'Night', multiplier: 2 } });
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/overtime-types/${other.json().data.id}`, headers: bearer(adminToken), payload: { name: 'Weekend' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT');
  });
});
