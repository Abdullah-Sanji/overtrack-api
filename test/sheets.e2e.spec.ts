import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { formatInTimeZone } from 'date-fns-tz';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam, createOvertimeType } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

const today = formatInTimeZone(new Date(), 'UTC', 'yyyy-MM-dd');
const thisPeriod = today.slice(0, 7);

describe('sheets and entries', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  let emp: Awaited<ReturnType<typeof createUser>>; let token: string; let typeId: string; let team: Awaited<ReturnType<typeof createTeam>>;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await truncateAll(db);
    team = await createTeam(db);
    emp = await createUser(db, { teamId: team.id }); token = (await login(app, emp.email, emp.password)).accessToken;
    typeId = (await createOvertimeType(db, { multiplier: '1.50' })).id;
  });

  const entry = (o: Record<string, unknown> = {}) => ({ date: today, startTime: '18:00', endTime: '20:30', overtimeTypeId: typeId, workItem: 'PROJ-12', description: 'Hotfix for payment service', ...o });

  async function sheetFor(period = thisPeriod) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/sheets/for-period', headers: bearer(token), payload: { period } });
    expect(res.statusCode).toBe(200);
    return res.json().data as { id: string; status: string; version: number };
  }

  it('for-period creates once and returns the same draft', async () => {
    const a = await sheetFor(); const b = await sheetFor();
    expect(a.id).toBe(b.id); expect(a.status).toBe('draft');
  });

  it('adds an entry, derives hours and weighted hours, recomputes totals', async () => {
    const s = await sheetFor();
    const res = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry() });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ hours: 2.5, multiplier: 1.5, weightedHours: 3.75, overtimeType: { id: typeId } });
    const d = await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.id}`, headers: bearer(token) });
    expect(d.json().data).toMatchObject({ totalHours: 2.5, totalWeightedHours: 3.75, employee: { id: emp.id, teamName: team.name } });
    expect(d.json().data.entries).toHaveLength(1);
  });

  it('rejects end before start, crossing midnight, and bad quarter steps', async () => {
    const s = await sheetFor();
    const r1 = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry({ startTime: '20:00', endTime: '18:00' }) });
    expect(r1.json().code).toBe('VALIDATION_FAILED');
    const r2 = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry({ startTime: '23:00', endTime: '01:00' }) });
    expect(r2.json().code).toBe('VALIDATION_FAILED');
    const r3 = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry({ hours: 1.3 }) });
    expect(r3.json().code).toBe('VALIDATION_FAILED');
  });

  it('rejects overlapping entries on the same date', async () => {
    const s = await sheetFor();
    await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry() });
    const r = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry({ startTime: '19:00', endTime: '21:00' }) });
    expect(r.statusCode).toBe(409); expect(r.json().code).toBe('ENTRY_OVERLAP');
    const ok = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry({ startTime: '20:30', endTime: '21:00' }) });
    expect(ok.statusCode).toBe(201);
  });

  it('rejects dates outside the period or in the future', async () => {
    const s = await sheetFor('2026-01');
    const out = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry({ date: '2026-02-01' }) });
    expect(out.json().code).toBe('ENTRY_OUT_OF_PERIOD');
    const cur = await sheetFor();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const fut = await app.inject({ method: 'POST', url: `/api/v1/sheets/${cur.id}/entries`, headers: bearer(token), payload: entry({ date: tomorrow }) });
    expect(['ENTRY_IN_FUTURE', 'ENTRY_OUT_OF_PERIOD']).toContain(fut.json().code);
  });

  it('updates and deletes entries, recomputing totals', async () => {
    const s = await sheetFor();
    const c = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry() });
    const id = c.json().data.id;
    const u = await app.inject({ method: 'PATCH', url: `/api/v1/sheets/${s.id}/entries/${id}`, headers: bearer(token), payload: { endTime: '19:00' } });
    expect(u.json().data.hours).toBe(1);
    await app.inject({ method: 'DELETE', url: `/api/v1/sheets/${s.id}/entries/${id}`, headers: bearer(token) });
    const d = await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.id}`, headers: bearer(token) });
    expect(d.json().data.totalHours).toBe(0); expect(d.json().data.entries).toHaveLength(0);
  });

  it('other employees cannot see or edit my sheet; admin can see it', async () => {
    const s = await sheetFor();
    const other = await createUser(db); const ot = (await login(app, other.email, other.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.id}`, headers: bearer(ot) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(ot), payload: entry() })).statusCode).toBe(403);
    const admin = await createUser(db, { role: 'admin' }); const at = (await login(app, admin.email, admin.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.id}`, headers: bearer(at) })).statusCode).toBe(200);
    // admin cannot add entries to someone else's sheet either
    expect((await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(at), payload: entry() })).statusCode).toBe(403);
  });

  it('lists my sheets only, newest period first', async () => {
    await sheetFor('2026-01'); await sheetFor('2026-03');
    const other = await createUser(db); const ot = (await login(app, other.email, other.password)).accessToken;
    await app.inject({ method: 'POST', url: '/api/v1/sheets/for-period', headers: bearer(ot), payload: { period: '2026-02' } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/sheets', headers: bearer(token) });
    expect(res.json().data.map((s: { period: string }) => s.period)).toEqual(['2026-03', '2026-01']);
  });
});
