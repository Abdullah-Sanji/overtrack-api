import { Db } from '@/database/drizzle.service';
import { users, teams, UserRole, overtimeTypes, sheets, sheetEntries, approvalChainSteps } from '@/database/schema';
import * as argon2 from 'argon2';

let counter = 0;

export async function createUser(db: Db, o: Partial<{ email: string; password: string; role: UserRole; teamId: string | null; firstName: string; lastName: string; isActive: boolean; employeeCode: string }> = {}) {
  counter += 1;
  const password = o.password ?? 'Password123!';
  const [u] = await db.insert(users).values({
    firstName: o.firstName ?? `User${counter}`,
    lastName: o.lastName ?? 'Test',
    email: o.email ?? `user${counter}@test.local`,
    passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    role: o.role ?? 'employee',
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
  const [s] = await db.insert(sheets).values({ employeeId, period: `${period}-01` }).returning();
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
