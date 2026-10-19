import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seed } from '@/database/seed';
import { DrizzleService } from '@/database/drizzle.service';
import { subMonths, format } from 'date-fns';

describe('full flow on seeded data', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => { app = await createTestApp(); await truncateAll(app.get(DrizzleService).db); await seed(app); });
  afterAll(async () => { await app.close(); });
  const tok = (email: string) => login(app, email, 'Password123!').then((r) => r.accessToken);
  const period = format(subMonths(new Date(), 1), 'yyyy-MM');

  it('employee submits → TL, DM, CTO approve → finance pays → export contains the row', async () => {
    const emp = await tok('emp1.platform@overtrack.local');
    const mine = await app.inject({ method: 'GET', url: `/api/v1/sheets?period=${period}`, headers: bearer(emp) });
    const sheet = mine.json().data[0]; expect(sheet.status).toBe('draft');
    let v = sheet.version;
    const act = async (email: string, action: string, extra: Record<string, unknown> = {}) => {
      const r = await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheet.id}/${action}`, headers: bearer(await tok(email)), payload: { version: v, ...extra } });
      expect(r.statusCode, r.body).toBe(200); v = r.json().data.version; return r.json().data;
    };
    await act('emp1.platform@overtrack.local', 'submit');
    await act('tl.platform@overtrack.local', 'approve');
    await act('dm.platform@overtrack.local', 'approve');
    const approved = await act('cto@overtrack.local', 'approve'); expect(approved.status).toBe('approved');
    const paid = await act('finance@overtrack.local', 'mark-paid', { paymentReference: 'E2E-1' }); expect(paid.status).toBe('paid');
    const csv = await app.inject({ method: 'GET', url: `/api/v1/reports/employees/export?period=${period}&format=csv`, headers: bearer(await tok('finance@overtrack.local')) });
    const line = csv.body.split('\n').find((l) => l.includes('Eve Platform') && l.includes('OT-101'));
    expect(line).toContain('paid');
  });
});
