import { eq } from 'drizzle-orm';
import { DbOrTx } from '@/database/drizzle.service';
import { roles, users, RoleLevel } from '@/database/schema';

export interface RoleRef { id: string; name: string; level: RoleLevel }
export const roleRef = { id: roles.id, name: roles.name, level: roles.level };
export interface UserWithRole { user: typeof users.$inferSelect; role: RoleRef }
export type PublicUser = Omit<typeof users.$inferSelect, 'passwordHash' | 'roleId'> & { role: RoleRef };

/** `select({ user, role }) from users join roles` — add `.where()`, `.orderBy()`, `.limit()` as needed. */
export function usersWithRole(db: DbOrTx) {
  return db.select({ user: users, role: roleRef }).from(users).innerJoin(roles, eq(roles.id, users.roleId));
}

export function toPublicUser(r: UserWithRole): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash: _p, roleId: _r, ...rest } = r.user;
  return { ...rest, role: r.role };
}
