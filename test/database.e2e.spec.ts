import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { createTestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { DrizzleService } from '@/database/drizzle.service';
import { users, sheets } from '@/database/schema';

describe('database', () => {
  let app: NestFastifyApplication;
  let drizzle: DrizzleService;
  beforeAll(async () => { app = await createTestApp(); drizzle = app.get(DrizzleService); await truncateAll(drizzle.db); });
  afterAll(async () => { await app.close(); });

  it('inserts a user and a sheet and enforces the unique period per employee', async () => {
    const [u] = await drizzle.db.insert(users).values({ firstName: 'A', lastName: 'B', email: 'a@b.c' }).returning();
    await drizzle.db.insert(sheets).values({ employeeId: u.id, period: '2026-09-01' });
    // drizzle-orm 0.44 wraps driver errors in DrizzleQueryError; the pg error is on .cause
    const err = await drizzle.db.insert(sheets).values({ employeeId: u.id, period: '2026-09-01' }).catch((e: unknown) => e);
    expect((err as { cause?: { code?: string; constraint?: string } }).cause).toMatchObject({ code: '23505', constraint: 'sheets_employee_period_idx' });
    const rows = await drizzle.db.select().from(sheets).where(eq(sheets.employeeId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('draft');
  });

  it('health pings the database', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
  });
});
