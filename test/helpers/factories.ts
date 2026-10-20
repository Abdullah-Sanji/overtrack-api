import { Db } from '@/database/drizzle.service';
import { users, teams, roles, LEGACY_ROLE_NAMES, LegacyRole, RoleLevel, overtimeTypes, sheets, sheetEntries, approvalChainSteps } from '@/database/schema';
import { eq } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { bearer } from './app';

let counter = 0;

const roleIds = new Map<string, string>();
export async function systemRoleId(db: Db, legacy: LegacyRole): Promise<string> {
  const name = LEGACY_ROLE_NAMES[legacy];
  const cached = roleIds.get(name);
  if (cached) return cached;
  const [r] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name));
  if (!r) throw new Error(`system role ${name} missing`);
  roleIds.set(name, r.id);
  return r.id;
}

export async function createRole(db: Db, o: Partial<{ name: string; level: RoleLevel }> = {}) {
  counter += 1;
  const [r] = await db.insert(roles).values({ name: o.name ?? `Role ${counter}`, level: o.level ?? 'employee' }).returning();
  return r;
}

export async function createUser(db: Db, o: Partial<{ email: string; password: string; role: LegacyRole; roleId: string; teamId: string | null; firstName: string; lastName: string; isActive: boolean; employeeCode: string }> = {}) {
  counter += 1;
  const password = o.password ?? 'Password123!';
  const [u] = await db.insert(users).values({
    firstName: o.firstName ?? `User${counter}`,
    lastName: o.lastName ?? 'Test',
    email: o.email ?? `user${counter}@test.local`,
    passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    role: o.role ?? 'employee',
    roleId: o.roleId ?? (await systemRoleId(db, o.role ?? 'employee')),
    teamId: o.teamId ?? null,
    isActive: o.isActive ?? true,
    employeeCode: o.employeeCode ?? `E${1000 + counter}`,
  }).returning();
  return { ...u, password };
}

export async function createTeam(db: Db, o: Partial<{ name: string; techLeadId: string | null }> = {}) {
  counter += 1;
  const [t] = await db.insert(teams).values({ name: o.name ?? `Team ${counter}`, techLeadId: o.techLeadId ?? null }).returning();
  return t;
}

export async function createOvertimeType(db: Db, o: Partial<{ name: string; multiplier: string }> = {}) {
  counter += 1;
  const [t] = await db.insert(overtimeTypes).values({ name: o.name ?? `Type ${counter}`, multiplier: o.multiplier ?? '1.50' }).returning();
  return t;
}

export async function createSheet(db: Db, employeeId: string, period = '2026-09') {
  const [emp] = await db.select({ teamId: users.teamId }).from(users).where(eq(users.id, employeeId));
  const [s] = await db.insert(sheets).values({ employeeId, teamId: emp?.teamId ?? null, period: `${period}-01` }).returning();
  return s;
}

export async function createEntry(db: Db, sheetId: string, typeId: string, o: Partial<{ date: string; startTime: string; endTime: string; hours: string; multiplier: string }> = {}) {
  const hours = o.hours ?? '2.00'; const multiplier = o.multiplier ?? '1.50';
  const [e] = await db.insert(sheetEntries).values({
    sheetId, date: o.date ?? '2026-09-10', startTime: o.startTime ?? '18:00', endTime: o.endTime ?? '20:00', hours, overtimeTypeId: typeId,
    multiplierSnapshot: multiplier, weightedHours: (Number(hours) * Number(multiplier)).toFixed(2), workItem: 'PROJ-1', description: 'Did some overtime work',
  }).returning();
  return e;
}

export async function createChain(db: Db, teamId: string, approvers: Array<{ label: string; approverId: string; backupApproverId?: string | null }>) {
  return db.insert(approvalChainSteps).values(approvers.map((a, i) => ({ teamId, position: i + 1, label: a.label, approverId: a.approverId, backupApproverId: a.backupApproverId ?? null }))).returning();
}

/** Builds team + chain (TL → DM → CTO), an employee with entries, and submits the sheet. */
export async function submittedSheet(app: NestFastifyApplication, db: Db, loginFn: (email: string, password: string) => Promise<{ accessToken: string }>) {
  const tl = await createUser(db, { role: 'tech_lead' }); const dm = await createUser(db, { role: 'delivery_manager' }); const cto = await createUser(db, { role: 'cto' });
  const team = await createTeam(db, { techLeadId: tl.id });
  await createChain(db, team.id, [{ label: 'Tech Lead', approverId: tl.id, backupApproverId: dm.id }, { label: 'Delivery Manager', approverId: dm.id }, { label: 'CTO', approverId: cto.id }]);
  const emp = await createUser(db, { teamId: team.id });
  const type = await createOvertimeType(db, { multiplier: '1.50' });
  const sheet = await createSheet(db, emp.id, '2026-09');
  await createEntry(db, sheet.id, type.id, { date: '2026-09-10' });
  await createEntry(db, sheet.id, type.id, { date: '2026-09-11' });
  const empToken = (await loginFn(emp.email, emp.password)).accessToken;
  const res = await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheet.id}/submit`, headers: bearer(empToken), payload: { version: 1 } });
  if (res.statusCode !== 200) throw new Error(`submit failed: ${res.body}`);
  return { tl, dm, cto, team, emp, type, sheetId: sheet.id as string, empToken, version: res.json().data.version as number };
}
