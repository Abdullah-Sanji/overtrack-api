import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { count, eq } from 'drizzle-orm';
import { createTestApp, login } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seed } from '@/database/seed';
import { DrizzleService } from '@/database/drizzle.service';
import { sheets, users } from '@/database/schema';

describe('seed', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; await truncateAll(db); });
  afterAll(async () => { await app.close(); });

  it('creates the demo dataset once', async () => {
    await seed(app); await seed(app);
    const [{ n }] = await db.select({ n: count() }).from(users); expect(Number(n)).toBe(3 + 2 * 5);
    expect((await login(app, 'admin@overtrack.local', 'Password123!')).accessToken).toBeTypeOf('string');
    const statuses = (await db.select({ s: sheets.status }).from(sheets)).map((r) => r.s).sort();
    expect(statuses).toEqual(['approved', 'draft', 'paid', 'rejected', 'submitted', 'submitted']);
    const [paid] = await db.select().from(sheets).where(eq(sheets.status, 'paid'));
    expect(paid.paymentReference).toBe('DEMO-BATCH-1');
  });
});
