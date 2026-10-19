import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam, createChain, createOvertimeType, createSheet, createEntry } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

describe('team month report', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); });
  const tok = (u: { email: string; password: string }) => login(app, u.email, u.password).then((r) => r.accessToken);

  async function fixture() {
    const tl = await createUser(db, { role: 'tech_lead' }); const team = await createTeam(db, { name: 'Platform', techLeadId: tl.id });
    await createChain(db, team.id, [{ label: 'TL', approverId: tl.id }]);
    const weekday = await createOvertimeType(db, { name: 'Weekday', multiplier: '1.50' }); const weekend = await createOvertimeType(db, { name: 'Weekend', multiplier: '2.00' });
    const a = await createUser(db, { teamId: team.id, firstName: 'Ann' }); const b = await createUser(db, { teamId: team.id, firstName: 'Bob' }); const c = await createUser(db, { teamId: team.id, firstName: 'Cid' });
    const sa = await createSheet(db, a.id, '2026-09'); await createEntry(db, sa.id, weekday.id, { hours: '2.00', multiplier: '1.50', date: '2026-09-01' }); await createEntry(db, sa.id, weekend.id, { hours: '4.00', multiplier: '2.00', date: '2026-09-05' });
    const sb = await createSheet(db, b.id, '2026-09'); await createEntry(db, sb.id, weekday.id, { hours: '1.00', multiplier: '1.50' });
    await db.execute(sql`update sheets set total_hours = (select coalesce(sum(hours),0) from sheet_entries e where e.sheet_id = sheets.id), total_weighted_hours = (select coalesce(sum(weighted_hours),0) from sheet_entries e where e.sheet_id = sheets.id)`);
    return { tl, team, a, b, c, weekday, weekend };
  }

  it('aggregates hours per type per employee, includes members without a sheet, and totals', async () => {
    const f = await fixture();
    const res = await app.inject({ method: 'GET', url: `/api/v1/reports/team-month?teamId=${f.team.id}&period=2026-09`, headers: bearer(await tok(f.tl)) });
    expect(res.statusCode).toBe(200);
    const r = res.json().data;
    expect(r.team.name).toBe('Platform'); expect(r.period).toBe('2026-09');
    expect(r.rows.map((x: { employee: { firstName: string } }) => x.employee.firstName)).toEqual(['Ann', 'Bob', 'Cid']);
    expect(r.rows[0]).toMatchObject({ totalHours: 6, totalWeightedHours: 11, hoursByType: { [f.weekday.id]: 2, [f.weekend.id]: 4 } });
    expect(r.rows[0].entries).toHaveLength(2);
    expect(r.rows[2]).toMatchObject({ sheet: null, totalHours: 0, entries: [] });
    expect(r.totals).toEqual({ totalHours: 7, totalWeightedHours: 12.5, hoursByType: { [f.weekday.id]: 3, [f.weekend.id]: 4 } });
  });

  it('enforces team visibility', async () => {
    const f = await fixture();
    const stranger = await createUser(db, { role: 'tech_lead' });
    expect((await app.inject({ method: 'GET', url: `/api/v1/reports/team-month?teamId=${f.team.id}&period=2026-09`, headers: bearer(await tok(stranger)) })).statusCode).toBe(403);
    const fin = await createUser(db, { role: 'finance' });
    expect((await app.inject({ method: 'GET', url: `/api/v1/reports/team-month?teamId=${f.team.id}&period=2026-09`, headers: bearer(await tok(fin)) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/reports/team-month?teamId=${f.team.id}&period=2026-09`, headers: bearer(await tok(f.a)) })).statusCode).toBe(403);
  });
});
