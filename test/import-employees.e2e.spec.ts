import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { asc, count, eq } from 'drizzle-orm';
import { createTestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { users } from '@/database/schema';
import { usersWithRole } from '@/users/public-user';
import { importEmployees } from '@/database/import-employees';

const row = (n: string, e: string, name: string, dept = 'Ops') => ({ EmployeeNumber: n, FullName: name, WorkEmail: e, JobTitle: '', Level: '', HireDate: '', Department: dept, Location: '' });

describe('import-employees', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); });
  const userCount = async () => Number((await db.select({ n: count() }).from(users))[0].n);

  it('creates users with employee role, admin for --admin, names split at first space, email lowercased', async () => {
    const rows = [row('EMP-1', ' Root@X.test ', 'Rae  Ann  Root', 'IT'), row('7', 'sam@x.test', 'Sam Lee', '')];
    const r = await importEmployees(app, rows, { adminEmail: 'root@x.test' });
    expect(r).toEqual({ created: ['root@x.test', 'sam@x.test'], skipped: [], problems: [] });
    const all = await usersWithRole(db).orderBy(asc(users.email));
    expect(all.map((x) => [x.user.email, x.user.firstName, x.user.lastName, x.user.employeeCode, x.user.department, x.role.level, x.user.passwordHash, x.user.teamId]))
      .toEqual([['root@x.test', 'Rae', 'Ann Root', 'EMP-1', 'IT', 'admin', null, null], ['sam@x.test', 'Sam', 'Lee', '7', null, 'employee', null, null]]);
  });

  it('re-run skips existing emails and never modifies them', async () => {
    await importEmployees(app, [row('1', 'a@x.test', 'A One'), row('2', 'b@x.test', 'B Two')], { adminEmail: 'a@x.test' });
    const again = await importEmployees(app, [row('1', 'a@x.test', 'Changed Name'), row('3', 'c@x.test', 'C Three')], { adminEmail: 'a@x.test' });
    expect(again.created).toEqual(['c@x.test']); expect(again.skipped).toEqual(['a@x.test']); expect(again.problems).toEqual([]);
    expect((await db.select().from(users).where(eq(users.email, 'a@x.test')))[0].firstName).toBe('A');
  });

  it('aborts without writing on duplicate email, duplicate code, one-word name, bad email, long code', async () => {
    const rows = [row('1', 'a@x.test', 'A One'), row('2', 'A@x.test', 'A Dup'), row('1', 'b@x.test', 'B Two'), row('3', 'c@x.test', 'Mononym'), row('4', 'not-an-email', 'D Four'), row('123456789012345678901', 'e@x.test', 'E Five')];
    const r = await importEmployees(app, rows, { adminEmail: 'a@x.test' });
    expect(r.created).toEqual([]);
    expect(r.problems).toEqual(['row 3: duplicate email a@x.test (also row 2)', 'row 4: duplicate employee code 1 (also row 2)', 'row 5: name must have at least two words', 'row 6: invalid email not-an-email', 'row 7: employee code longer than 20 characters']);
    expect(await userCount()).toBe(0);
  });

  it('aborts when an employee code already belongs to another user', async () => {
    await createUser(db, { email: 'old@x.test', employeeCode: 'E9' });
    const r = await importEmployees(app, [row('E9', 'new@x.test', 'N New')], { adminEmail: 'new@x.test' });
    expect(r.problems).toEqual(['row 2: employee code E9 already belongs to old@x.test']); expect(r.created).toEqual([]);
    expect(await userCount()).toBe(1);
  });

  it('aborts when --admin is not in the file', async () => {
    const r = await importEmployees(app, [row('1', 'a@x.test', 'A One')], { adminEmail: 'boss@x.test' });
    expect(r.problems).toEqual(['file: admin email boss@x.test not found in the sheet']); expect(await userCount()).toBe(0);
  });

  it('dry run reports but writes nothing', async () => {
    const r = await importEmployees(app, [row('1', 'a@x.test', 'A One')], { adminEmail: 'a@x.test', dryRun: true });
    expect(r.created).toEqual(['a@x.test']); expect(await userCount()).toBe(0);
  });

  it('imported users cannot password-login and get 401 INVALID_CREDENTIALS', async () => {
    await importEmployees(app, [row('1', 'a@x.test', 'A One')], { adminEmail: 'a@x.test' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'a@x.test', password: 'Password123!' } });
    expect(res.statusCode).toBe(401); expect(res.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a sheet missing a required header', async () => {
    const r = await importEmployees(app, [{ Name: 'x' }], { adminEmail: 'a@x.test' });
    expect(r.problems).toEqual(['file: missing column(s) EmployeeNumber, FullName, WorkEmail, Department']);
  });
});
