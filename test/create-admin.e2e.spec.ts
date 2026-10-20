import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { count } from 'drizzle-orm';
import { createTestApp, login } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createAdmin } from '@/database/create-admin';
import { seed } from '@/database/seed';
import { DrizzleService } from '@/database/drizzle.service';
import { overtimeTypes, settings, users } from '@/database/schema';
import { BootstrapService } from '@/bootstrap/bootstrap.service';
import { RolesService } from '@/roles/roles.service';
import { OvertimeTypesService } from '@/overtime-types/overtime-types.service';

describe('create-admin', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); });

  it('creates an admin once and the admin can log in', async () => {
    const input = { email: 'Root@Example.com', password: 'a-long-password-1', firstName: 'Root', lastName: 'Admin' };
    expect(await createAdmin(app, input)).toBe('created');
    expect(await createAdmin(app, input)).toBe('exists');
    const [{ n }] = await db.select({ n: count() }).from(users); expect(Number(n)).toBe(1);
    expect((await login(app, 'root@example.com', input.password)).accessToken).toBeTypeOf('string');
  });

  it('bootstrap seeds default types and settings idempotently outside test env', async () => {
    const svc = new BootstrapService(app.get(DrizzleService), app.get(RolesService), app.get(OvertimeTypesService), { get: (k: string) => (k === 'NODE_ENV' ? 'production' : 'UTC') } as never);
    await svc.onModuleInit(); await svc.onModuleInit();
    const [{ t }] = await db.select({ t: count() }).from(overtimeTypes); expect(Number(t)).toBeGreaterThan(0);
    const [{ n }] = await db.select({ n: count() }).from(settings); expect(Number(n)).toBe(1);
  });

  it('rejects a short password', async () => {
    await expect(createAdmin(app, { email: 'a@b.co', password: 'short', firstName: 'A', lastName: 'B' })).rejects.toThrow();
  });
});

describe('seed in production', () => {
  const prev = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = prev; });
  it('refuses to run', async () => {
    process.env.NODE_ENV = 'production';
    await expect(seed({} as never)).rejects.toThrow('seed is not allowed in production');
  });
});
