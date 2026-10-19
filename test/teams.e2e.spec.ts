import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

describe('teams', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let adminToken: string; let employeeToken: string;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await truncateAll(db);
    const admin = await createUser(db, { role: 'admin' }); adminToken = (await login(app, admin.email, admin.password)).accessToken;
    const emp = await createUser(db); employeeToken = (await login(app, emp.email, emp.password)).accessToken;
  });

  it('admin creates and updates a team with a tech lead', async () => {
    const lead = await createUser(db, { role: 'tech_lead' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/teams', headers: bearer(adminToken), payload: { name: 'Platform', techLeadId: lead.id } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ name: 'Platform', techLead: { id: lead.id }, memberCount: 0, chainStepCount: 0 });
    const up = await app.inject({ method: 'PATCH', url: `/api/v1/teams/${res.json().data.id}`, headers: bearer(adminToken), payload: { description: 'Core infra' } });
    expect(up.json().data.description).toBe('Core infra');
  });

  it('rejects duplicate team names', async () => {
    await createTeam(db, { name: 'Platform' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/teams', headers: bearer(adminToken), payload: { name: 'Platform' } });
    expect(res.json().code).toBe('TEAM_NAME_TAKEN');
    expect(res.statusCode).toBe(409);
  });

  it('employees can list teams but not create them', async () => {
    await createTeam(db, { name: 'A' }); await createTeam(db, { name: 'B' });
    const list = await app.inject({ method: 'GET', url: '/api/v1/teams', headers: bearer(employeeToken) });
    expect(list.json().meta.total).toBe(2);
    const create = await app.inject({ method: 'POST', url: '/api/v1/teams', headers: bearer(employeeToken), payload: { name: 'C' } });
    expect(create.statusCode).toBe(403);
  });

  it('lists members', async () => {
    const t = await createTeam(db);
    await createUser(db, { teamId: t.id }); await createUser(db, { teamId: t.id }); await createUser(db);
    const res = await app.inject({ method: 'GET', url: `/api/v1/teams/${t.id}/members`, headers: bearer(employeeToken) });
    expect(res.json().data).toHaveLength(2);
  });

  it('returns 404 when the tech lead does not exist (create and update)', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/teams', headers: bearer(adminToken), payload: { name: 'Ghost', techLeadId: randomUUID() } });
    expect(created.statusCode).toBe(404);
    expect(created.json().code).toBe('NOT_FOUND');
    const t = await createTeam(db);
    const updated = await app.inject({ method: 'PATCH', url: `/api/v1/teams/${t.id}`, headers: bearer(adminToken), payload: { techLeadId: randomUUID() } });
    expect(updated.statusCode).toBe(404);
    expect(updated.json().code).toBe('NOT_FOUND');
  });
});
