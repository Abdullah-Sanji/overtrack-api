import { Db } from '@/database/drizzle.service';
import { users, teams, UserRole } from '@/database/schema';
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
