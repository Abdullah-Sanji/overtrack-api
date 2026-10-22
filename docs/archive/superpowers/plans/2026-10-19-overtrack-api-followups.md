# OverTrack API follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roles become admin-managed data with a four-level permission model, and admins can hard-delete users and teams that have no history.

**Architecture:** A `roles` table replaces the `user_role` enum; every permission check switches from role names to `role.level`. The switch is done in three green steps (add the table and column, move the code over, drop the old column) so the suite passes after every task. Deletes are guarded by existence checks inside one transaction and return 409 codes the web can show.

**Tech Stack:** NestJS 11 on Fastify 5, Drizzle ORM 0.44 + node-postgres, nestjs-zod v5, Vitest + Testcontainers (postgres:16), pnpm.

**Spec:** `docs/superpowers/specs/2026-10-19-overtrack-followups-design.md` (amends `2026-10-18-overtrack-design.md`; the new spec wins on conflict).

## Global Constraints

- Node 22, pnpm 11. Run every command from the repo root `/Users/sanji/WebstormProjects/over-track-api`.
- Before any `pnpm build`, `pnpm seed` or `pnpm create-admin`, run `rm -rf dist` (the build deletes and recreates `dist`; incremental TypeScript is off).
- `pnpm test` runs the whole suite against a Testcontainers Postgres and takes about 40 s. Run a single file with `pnpm vitest run test/<file>.spec.ts`.
- `pnpm lint` must stay clean. Formatting: `pnpm format` (Prettier) before committing.
- Every error thrown to a client is a `DomainError` with a code listed in `src/common/errors/domain-error.ts`. New codes in this plan: `ROLE_NAME_TAKEN`, `ROLE_IS_SYSTEM`, `ROLE_IN_USE`, `CANNOT_DEMOTE_SELF`, `USER_HAS_HISTORY`, `CANNOT_DELETE_SELF`, `TEAM_IN_USE` (all 409).
- Drizzle wraps pg errors: use `uniqueViolationConstraint(err)` / `foreignKeyViolationConstraint(err)` from `src/common/errors/pg.ts`, never `err.code` directly.
- Migrations are hand-written SQL in `drizzle/` with `--> statement-breakpoint` separators plus an entry in `drizzle/meta/_journal.json`. The migrator (`src/database/migrate.ts`) applies each file in a transaction.
- Role levels, verbatim: `employee`, `manager`, `finance`, `admin`. System role names, verbatim: `Employee`, `Tech Lead`, `Delivery Manager`, `CTO`, `Finance`, `Admin`.
- Audit: every create/update/delete of a role, user or team records an `audit_log` row through `AuditService.record(tx, …)` inside the same transaction.
- Test count must stay at or above 132 after Task 6.

## Review Focus

1. A stale access token issued before the deploy carries `role` but no `level`: the guard must reject it with 401 `TOKEN_EXPIRED` so the client refreshes, never let it through with `level: undefined`. Test in Task 2 (`jwt-auth.guard` test).
2. A user whose role name is changed keeps their id, so an open session continues; a user whose role *level* changes must be denied the old level's routes after re-login. Test in Task 2 (guard spec: "level change applies after re-login").
3. Role names differing only by case (`admin` vs `Admin`) must collide. Test in Task 4.
4. Deleting a user who is only a *backup* approver on a chain, or only `decided_by` on a step, must be refused: each of the seven history sources is tested individually in Task 5.
5. Deleting a team whose only link is a sheet snapshot (`sheets.team_id`) from a member who has since left must be refused. Test in Task 6.

---

### Task 1: Roles table, migration 0002, bootstrap and test helpers

**Files:**
- Create: `src/database/schema/roles.ts`
- Create: `drizzle/0002_roles.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/database/schema/index.ts`
- Modify: `src/database/schema/users-teams.ts` (add `roleId`; keep `role` for now)
- Modify: `src/database/migrate.ts` (optional migrations folder argument)
- Create: `src/roles/roles.service.ts`, `src/roles/roles.module.ts`
- Modify: `src/bootstrap/bootstrap.service.ts`, `src/bootstrap/bootstrap.module.ts`
- Modify: `test/helpers/db.ts`, `test/helpers/factories.ts`
- Test: `test/roles-migration.e2e.spec.ts`

**Interfaces:**
- Produces: `roles` table and `roleLevelEnum`; `RoleLevel = 'employee' | 'manager' | 'finance' | 'admin'`; `ROLE_LEVELS` const; `SYSTEM_ROLES: Array<{ name: string; level: RoleLevel }>`; `RolesService.ensureSystemRoles(db?): Promise<Map<string, string>>` (name → id); factory option `createUser(db, { role: 'admin' })` keeps the legacy literal names and maps them to system roles; `createRole(db, { name, level })`; `runMigrations(url, migrationsFolder?)`.

- [ ] **Step 1: Schema**

`src/database/schema/roles.ts`:

```ts
import { pgTable, pgEnum, uuid, text, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const ROLE_LEVELS = ['employee', 'manager', 'finance', 'admin'] as const;
export const roleLevelEnum = pgEnum('role_level', ROLE_LEVELS);
export type RoleLevel = (typeof ROLE_LEVELS)[number];

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    level: roleLevelEnum('level').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('roles_name_idx').on(sql`lower(${t.name})`)],
);

export const SYSTEM_ROLES: Array<{ name: string; level: RoleLevel }> = [
  { name: 'Employee', level: 'employee' },
  { name: 'Tech Lead', level: 'manager' },
  { name: 'Delivery Manager', level: 'manager' },
  { name: 'CTO', level: 'manager' },
  { name: 'Finance', level: 'finance' },
  { name: 'Admin', level: 'admin' },
];

/** Old enum value → system role name, used by the migration test and the test factories. */
export const LEGACY_ROLE_NAMES = {
  employee: 'Employee', tech_lead: 'Tech Lead', delivery_manager: 'Delivery Manager', cto: 'CTO', finance: 'Finance', admin: 'Admin',
} as const;
export type LegacyRole = keyof typeof LEGACY_ROLE_NAMES;
```

In `src/database/schema/index.ts` add `export * from './roles';` as the second line (after `./enums`).

In `src/database/schema/users-teams.ts`: import `roles` from `./roles` and add, directly under the existing `role` line, `roleId: uuid('role_id').notNull().references(() => roles.id),` and an index: change the third argument to `(t) => [uniqueIndex('users_email_idx').on(t.email), uniqueIndex('users_employee_code_idx').on(t.employeeCode), index('users_role_idx').on(t.roleId)]` (import `index` from drizzle-orm/pg-core). Keep the `role` enum column for now; Task 2 removes it from the schema and Task 3 drops it from the database.

- [ ] **Step 2: Migration**

`drizzle/0002_roles.sql`:

```sql
CREATE TYPE "public"."role_level" AS ENUM('employee', 'manager', 'finance', 'admin');--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"level" "role_level" NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_idx" ON "roles" USING btree (lower("name"));--> statement-breakpoint
INSERT INTO "roles" ("name", "level", "is_system") VALUES
	('Employee', 'employee', true), ('Tech Lead', 'manager', true), ('Delivery Manager', 'manager', true),
	('CTO', 'manager', true), ('Finance', 'finance', true), ('Admin', 'admin', true);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role_id" uuid;--> statement-breakpoint
UPDATE "users" u SET "role_id" = r."id" FROM "roles" r WHERE r."name" = CASE u."role"::text
	WHEN 'employee' THEN 'Employee' WHEN 'tech_lead' THEN 'Tech Lead' WHEN 'delivery_manager' THEN 'Delivery Manager'
	WHEN 'cto' THEN 'CTO' WHEN 'finance' THEN 'Finance' WHEN 'admin' THEN 'Admin' END;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role_id");
```

Append to `drizzle/meta/_journal.json` `entries`:

```json
{ "idx": 2, "version": "7", "when": 1792500000000, "tag": "0002_roles", "breakpoints": true }
```

`src/database/migrate.ts`: change the signature to `export async function runMigrations(databaseUrl: string, migrationsFolder = path.resolve(__dirname, '../../drizzle')): Promise<void>` and pass `migrationsFolder` to `migrate(...)`.

- [ ] **Step 3: RolesService (ensureSystemRoles only, the rest comes in Task 4) and bootstrap**

`src/roles/roles.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DbOrTx, DrizzleService } from '@/database/drizzle.service';
import { roles, SYSTEM_ROLES } from '@/database/schema';

@Injectable()
export class RolesService {
  constructor(private readonly drizzle: DrizzleService) {}

  /** Inserts the six system roles when missing (matched case-insensitively by name) and returns name → id. */
  async ensureSystemRoles(db: DbOrTx = this.drizzle.db): Promise<Map<string, string>> {
    await db.insert(roles).values(SYSTEM_ROLES.map((r) => ({ ...r, isSystem: true }))).onConflictDoNothing();
    const rows = await db.select({ id: roles.id, name: roles.name }).from(roles);
    return new Map(rows.map((r) => [r.name, r.id]));
  }
}
```

`src/roles/roles.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { RolesService } from './roles.service';
@Module({ providers: [RolesService], exports: [RolesService] })
export class RolesModule {}
```

Register `RolesModule` in `src/app.module.ts` imports (after `AuditModule`). In `src/bootstrap/bootstrap.module.ts` import `RolesModule`; in `BootstrapService` inject `private readonly rolesSvc: RolesService` and call `await this.rolesSvc.ensureSystemRoles();` as the first line after the test-env guard. Update the `BootstrapService` constructor call in `test/create-admin.e2e.spec.ts` ("bootstrap seeds default types…") to pass `app.get(RolesService)` as the new second argument: `new BootstrapService(app.get(DrizzleService), app.get(RolesService), app.get(OvertimeTypesService), {...} as never)` — the constructor order is `(drizzle, rolesSvc, types, config)`.

- [ ] **Step 4: Test helpers**

`test/helpers/db.ts`: after the TRUNCATE statement add `await db.execute(sql\`DELETE FROM roles WHERE NOT is_system\`);`. System roles survive truncation because `roles` is not in the list and nothing cascades to it.

`test/helpers/factories.ts`: add imports `roles, LEGACY_ROLE_NAMES, LegacyRole, RoleLevel` from `@/database/schema`; replace `UserRole` with `LegacyRole`; add a cache and lookup:

```ts
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
```

In `createUser` accept `roleId?: string` in the options type and insert `role: o.role ?? 'employee', roleId: o.roleId ?? (await systemRoleId(db, o.role ?? 'employee'))`. (The `role` column insert stays until Task 2.) The role id cache is safe because system roles are never truncated.

- [ ] **Step 5: Migration test**

`test/roles-migration.e2e.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations } from '@/database/migrate';

const DRIZZLE = path.resolve(__dirname, '../drizzle');

/** Copies the migrations folder with only the first `n` journal entries. */
function partialMigrations(n: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-mig-'));
  fs.mkdirSync(path.join(dir, 'meta'));
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, n);
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries) fs.copyFileSync(path.join(DRIZZLE, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}

describe('migration 0002_roles', () => {
  it('backfills role_id from the old enum for every user', async () => {
    const base = new URL(process.env.DATABASE_URL!);
    const admin = new Pool({ connectionString: base.toString() });
    await admin.query('DROP DATABASE IF EXISTS mig_check');
    await admin.query('CREATE DATABASE mig_check');
    await admin.end();
    const url = new URL(base.toString()); url.pathname = '/mig_check';

    await runMigrations(url.toString(), partialMigrations(2));
    const pool = new Pool({ connectionString: url.toString() });
    const legacy = ['employee', 'tech_lead', 'delivery_manager', 'cto', 'finance', 'admin'];
    for (const r of legacy) await pool.query(`INSERT INTO users (first_name, last_name, email, role) VALUES ('A', 'B', '${r}@m.local', '${r}')`);
    await pool.end();

    await runMigrations(url.toString());
    const after = new Pool({ connectionString: url.toString() });
    const { rows } = await after.query(`SELECT u.email, r.name, r.level, r.is_system FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.email`);
    await after.end();
    expect(rows).toEqual([
      { email: 'admin@m.local', name: 'Admin', level: 'admin', is_system: true },
      { email: 'cto@m.local', name: 'CTO', level: 'manager', is_system: true },
      { email: 'delivery_manager@m.local', name: 'Delivery Manager', level: 'manager', is_system: true },
      { email: 'employee@m.local', name: 'Employee', level: 'employee', is_system: true },
      { email: 'finance@m.local', name: 'Finance', level: 'finance', is_system: true },
      { email: 'tech_lead@m.local', name: 'Tech Lead', level: 'manager', is_system: true },
    ]);
  });
});
```

After Task 3 adds migration 0003 this test still passes: `partialMigrations(2)` applies 0000 and 0001, then the full run applies 0002 and 0003.

- [ ] **Step 6: Run and commit**

Run: `pnpm lint && pnpm test`
Expected: all green (132 + 1).

```bash
git add -A && git commit -m "feat(roles): roles table, migration 0002, system roles bootstrap"
```

---

### Task 2: Switch auth context, guards and user payloads to role levels

**Files:**
- Create: `src/users/public-user.ts`
- Modify: `src/common/auth/auth-user.ts`, `src/common/auth/jwt-auth.guard.ts`
- Rename: `src/common/auth/roles.decorator.ts` → `levels.decorator.ts`; `roles.guard.ts` → `levels.guard.ts`
- Modify: `src/app.module.ts`, `src/auth/auth.service.ts`, `src/auth/token.service.ts`
- Modify: `src/users/users.service.ts`, `src/users/users.dto.ts`, `src/users/users.controller.ts`, `src/users/users.module.ts`
- Modify: `src/teams/teams.service.ts`, `src/teams/teams.controller.ts`
- Modify: `src/workflow/transition.ts`, `src/workflow/workflow.service.ts`, `src/workflow/workflow.controller.ts`, `src/workflow/inbox.service.ts`
- Modify: `src/sheets/visibility.service.ts`, `src/reports/reports.controller.ts`, `src/audit/audit.controller.ts`, `src/approval-chains/approval-chains.controller.ts`, `src/overtime-types/overtime-types.controller.ts`, `src/notifications/notifications.listener.ts`
- Modify: `src/database/schema/users-teams.ts` (remove `role` column), `src/database/seed.ts`, `src/database/create-admin.ts`
- Modify: `test/helpers/factories.ts`, every `test/*.spec.ts` and `src/workflow/transition.spec.ts` that references role literals
- Test: `test/levels.e2e.spec.ts`

**Interfaces:**
- Consumes: `roles`, `RoleLevel`, `SYSTEM_ROLES`, `RolesService.ensureSystemRoles`, `systemRoleId` from Task 1.
- Produces: `AuthUser = { id: string; roleId: string; level: RoleLevel; teamId: string | null }`; `@Levels(...levels: RoleLevel[])`; `LevelsGuard`; `MANAGER_LEVELS = ['manager', 'finance', 'admin']`; `RoleRef = { id: string; name: string; level: RoleLevel }`; `PublicUser` (users row minus `passwordHash`/`roleId`, plus `role: RoleRef`); `usersWithRole(db)` query builder; `toPublicUser(row)`; `UsersService.listByLevel(level)`; DTOs take `roleId`.

- [ ] **Step 1: Public user shape**

`src/users/public-user.ts`:

```ts
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
  const { passwordHash: _p, roleId: _r, ...rest } = r.user;
  return { ...rest, role: r.role };
}
```

Remove `PublicUser` and `toPublicUser` from `src/auth/auth.service.ts` and import them from `@/users/public-user` there and in `users.service.ts`, `teams.service.ts`.

- [ ] **Step 2: Auth context and guards**

`src/common/auth/auth-user.ts`:

```ts
import { RoleLevel } from '@/database/schema';
export interface AuthUser { id: string; roleId: string; level: RoleLevel; teamId: string | null }
export const MANAGER_LEVELS: RoleLevel[] = ['manager', 'finance', 'admin'];
export const isAdmin = (u: Pick<AuthUser, 'level'>) => u.level === 'admin';
export const isFinanceOrAdmin = (u: Pick<AuthUser, 'level'>) => u.level === 'finance' || u.level === 'admin';
```

`src/common/auth/levels.decorator.ts` (delete `roles.decorator.ts`):

```ts
import { SetMetadata } from '@nestjs/common';
import { RoleLevel } from '@/database/schema';
export const LEVELS_KEY = 'levels';
export const Levels = (...levels: RoleLevel[]) => SetMetadata(LEVELS_KEY, levels);
```

`src/common/auth/levels.guard.ts` (delete `roles.guard.ts`): same body as the old guard with `LEVELS_KEY`, `RoleLevel[]`, `levels.includes(user.level)` and the message `'Insufficient role level'`. Register `LevelsGuard` in `app.module.ts` in place of `RolesGuard`.

`src/common/auth/jwt-auth.guard.ts`: payload type `{ sub: string; roleId: string; level: RoleLevel; teamId: string | null }`; after verifying, `if (!payload.level || !payload.roleId) throw new DomainError('TOKEN_EXPIRED', 'Token predates the roles upgrade', 401);` then `req.user = { id: payload.sub, roleId: payload.roleId, level: payload.level, teamId: payload.teamId ?? null }`.

`src/auth/token.service.ts`: `issueAccessToken(user: { id: string; roleId: string; level: RoleLevel; teamId: string | null })` signs `{ sub: user.id, roleId: user.roleId, level: user.level, teamId: user.teamId }`. `rotateRefreshToken` loads the user with `usersWithRole(db).where(eq(users.id, row.userId))` and returns `user: UserWithRole`; its inactive check reads `user.user.isActive`.

`src/auth/auth.service.ts`: `login` loads `const [row] = await usersWithRole(db).where(eq(users.email, email.toLowerCase()))`; use `row?.user.passwordHash`, `row.user.isActive`; `issueAccessToken({ id: row.user.id, roleId: row.user.roleId, level: row.role.level, teamId: row.user.teamId })`; return `user: toPublicUser(row)`. `refresh`: `const { user, ...refresh } = await this.tokens.rotateRefreshToken(raw); const accessToken = await this.tokens.issueAccessToken({ id: user.user.id, roleId: user.user.roleId, level: user.role.level, teamId: user.user.teamId });`. `me` uses `usersWithRole`.

- [ ] **Step 3: Replace every `@Roles` and `.role` check**

Use this table; each line is a mechanical edit:

| file | change |
|---|---|
| `users.controller.ts` | `@Roles('admin')` → `@Levels('admin')`, import from `levels.decorator` |
| `teams.controller.ts`, `approval-chains.controller.ts`, `overtime-types.controller.ts`, `audit.controller.ts` | `@Roles('admin')` → `@Levels('admin')` |
| `workflow.controller.ts` | `@Roles('finance', 'admin')` → `@Levels('finance', 'admin')`; `@Roles('admin')` → `@Levels('admin')` |
| `reports.controller.ts` | `@Roles(...MANAGER_ROLES)` → `@Levels(...MANAGER_LEVELS)` |
| `visibility.service.ts:13` | `if (isFinanceOrAdmin(actor)) return 'all';` |
| `inbox.service.ts:22` | `cond = actor.level === 'admin' ? current : and(current, mine)!;` |
| `transition.ts` | `export type Actor = { id: string; level: RoleLevel };` import `RoleLevel` from `@/database/schema`; `isFinance = (a) => a.level === 'finance' \|\| a.level === 'admin'`; `const isAdmin = actor.level === 'admin'`; reopen: `if (actor.level !== 'admin')` |
| `workflow.service.ts:38` | `{ id: actor.id, level: actor.level }` |
| `notifications.listener.ts:49` | `await this.users.listByLevel('finance')` |

- [ ] **Step 4: Users and teams services and DTOs**

`users.dto.ts`: remove `zRole`; `CreateUserDto` takes `roleId: zUuid` instead of `role`; `UpdateUserDto` takes `roleId: zUuid.optional()`; `ListUsersQueryDto` takes `roleId: zUuid.optional()` instead of `role`.

`users.service.ts`:
- `findById`, `list`, `update`, `setActive`, `resendInvite`, `forgotPassword`, `changePassword`: load through `usersWithRole(db or tx)`; pass the row to `toPublicUser`; where the plain users row is needed (`sendInvite`, argon2 checks) use `row.user`.
- `list` filter: `if (q.roleId) where.push(eq(users.roleId, q.roleId));` and the rows query becomes `usersWithRole(this.drizzle.db).where(cond).orderBy(asc(users.lastName), asc(users.firstName)).limit(p.limit).offset(p.offset)`.
- `directory`: select `{ id, firstName, lastName, teamId, role: roleRef }` with the roles join.
- `create`: insert `{ ...dto, email, timezone }` (dto now carries `roleId`); after insert, reload with `usersWithRole(tx)` for the audit payload and return value.
- `listByLevel(level: RoleLevel)`: `usersWithRole(db).where(and(eq(roles.level, level), eq(users.isActive, true)))` mapped through `toPublicUser`. Delete `listByRole`.
- `mapDbError`: add `if (foreignKeyViolationConstraint(err) === 'users_role_id_roles_id_fk') return new DomainError('NOT_FOUND', 'Role not found', 404);`.

`teams.service.ts` `members`: `usersWithRole(db).where(and(eq(users.teamId, id), eq(users.isActive, true))).orderBy(asc(users.lastName))` mapped through `toPublicUser`.

`users-teams.ts`: delete the `role: userRoleEnum('role')…` line and the `userRoleEnum` import. (The database column still exists until Task 3; inserts omit it and its default applies.)

- [ ] **Step 5: Seed and create-admin**

`seed.ts`: replace the admin check with
```ts
const [{ n }] = await db.select({ n: count() }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(roles.level, 'admin'));
```
then `const roleIds = await app.get(RolesService).ensureSystemRoles();` and `mk(email, firstName, lastName, roleName: string, teamId, code)` inserts `roleId: roleIds.get(roleName)!`. Call sites: `'admin'→'Admin'`, `'finance'→'Finance'`, `'cto'→'CTO'`, `'tech_lead'→'Tech Lead'`, `'delivery_manager'→'Delivery Manager'`, `'employee'→'Employee'`. `admin: AuthUser = { id: adminUser.id, roleId: roleIds.get('Admin')!, level: 'admin', teamId: null }`. `actorOf(u)` needs the level: keep a local `levelOf = new Map<string, RoleLevel>()` filled in `mk` (`levelOf.set(row.id, SYSTEM_ROLES.find(r => r.name === roleName)!.level)`) and return `{ id: u.id, roleId: u.roleId, level: levelOf.get(u.id)!, teamId: u.teamId }`.

`create-admin.ts`: `const roleIds = await app.get(RolesService).ensureSystemRoles(); … .values({ …, roleId: roleIds.get('Admin')!, isActive: true, passwordHash })`.

- [ ] **Step 6: Tests**

`test/helpers/factories.ts`: drop the `role:` column from the insert (keep the option name `role` for the legacy literal and the `roleId` mapping from Task 1). `submittedSheet` is unchanged.

Update assertions that compared role literals:
- `test/auth.e2e.spec.ts:21` → `role: { name: 'Employee', level: 'employee' }`.
- `test/users.e2e.spec.ts`: payloads `role: 'employee'` → `roleId: await systemRoleId(db, 'employee')`; line 110 key list stays `['firstName','id','lastName','role','teamId']`; line 111 → `role: { name: 'Delivery Manager', level: 'manager' }`.
- `src/workflow/transition.spec.ts`: every actor `{ id, role: 'x' }` → `{ id, level }` using employee→`employee`, tech_lead/delivery_manager/cto→`manager`, finance→`finance`, admin→`admin`.
- Any other spec that posts `role:` to `/users` switches to `roleId`.

`test/levels.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createRole } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { users } from '@/database/schema';

describe('role levels', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); });

  it('a custom role with level admin reaches admin routes; level employee does not', async () => {
    const custom = await createRole(db, { name: 'Ops Admin', level: 'admin' });
    const u = await createUser(db, { roleId: custom.id });
    const token = (await login(app, u.email, u.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: bearer(token) })).statusCode).toBe(200);
    const emp = await createUser(db);
    const t2 = (await login(app, emp.email, emp.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: bearer(t2) })).statusCode).toBe(403);
  });

  it('a level change applies after re-login', async () => {
    const r = await createRole(db, { name: 'Shifting', level: 'admin' });
    const u = await createUser(db, { roleId: r.id });
    const t1 = (await login(app, u.email, u.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: bearer(t1) })).statusCode).toBe(200);
    const employeeRole = await createRole(db, { name: 'Plain', level: 'employee' });
    await db.update(users).set({ roleId: employeeRole.id }).where(eq(users.id, u.id));
    const t2 = (await login(app, u.email, u.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: bearer(t2) })).statusCode).toBe(403);
  });

  it('rejects a pre-upgrade token that carries role but no level', async () => {
    const u = await createUser(db, { role: 'admin' });
    const legacy = await app.get(JwtService).signAsync({ sub: u.id, role: 'admin', teamId: null }, { expiresIn: 900 });
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(legacy) });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('TOKEN_EXPIRED');
  });

  it('/me returns the role object', async () => {
    const u = await createUser(db, { role: 'finance' });
    const token = (await login(app, u.email, u.password)).accessToken;
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(token) });
    expect(res.json().data.role).toMatchObject({ name: 'Finance', level: 'finance' });
    expect(res.json().data).not.toHaveProperty('roleId');
  });
});
```

- [ ] **Step 7: Run and commit**

Run: `pnpm lint && pnpm test`
Expected: green.

```bash
git add -A && git commit -m "feat(roles): permission checks by role level; user payloads carry role {id,name,level}"
```

---

### Task 3: Drop the legacy role column

**Files:**
- Create: `drizzle/0003_drop_user_role.sql`
- Modify: `drizzle/meta/_journal.json`, `src/database/schema/enums.ts`, `src/database/schema/roles.ts` (keep `LEGACY_ROLE_NAMES`), `README.md`

- [ ] **Step 1: Migration**

`drizzle/0003_drop_user_role.sql`:

```sql
ALTER TABLE "users" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."user_role";
```

Journal entry: `{ "idx": 3, "version": "7", "when": 1792500100000, "tag": "0003_drop_user_role", "breakpoints": true }`.

`enums.ts`: delete `userRoleEnum` and `UserRole`. Grep `UserRole` and `userRoleEnum` across `src` and `test`; the only remaining references should be none (Task 2 removed them). The migration test's raw insert of `role` runs against the 0001 state, so it still works.

- [ ] **Step 2: README**

In `README.md` under "Run locally", after the seeded logins line, add:

```
Roles are data: six system roles (Employee, Tech Lead, Delivery Manager, CTO, Finance, Admin) are created on first start and
admins can add more under Admin → Roles. A role's *level* (employee, manager, finance, admin) decides permissions.
Migration 0003 drops the old `user_role` enum; back up the database before running it in production.
```

- [ ] **Step 3: Run and commit**

Run: `pnpm lint && pnpm test`

```bash
git add -A && git commit -m "feat(roles): drop legacy user_role column (migration 0003)"
```

---

### Task 4: Roles endpoints

**Files:**
- Modify: `src/roles/roles.service.ts`, `src/roles/roles.module.ts`
- Create: `src/roles/roles.dto.ts`, `src/roles/roles.controller.ts`
- Modify: `src/common/errors/domain-error.ts`, `src/audit/audit.service.ts`, `src/audit/audit.dto.ts`
- Test: `test/roles.e2e.spec.ts`

**Interfaces:**
- Produces: `GET /roles` (any signed-in user) → `{ data: RoleView[] }`; `POST /roles` (admin) → 201 `{ data: RoleView }`; `PATCH /roles/:id` (admin); `DELETE /roles/:id` (admin) → 204. `RoleView = { id, name, level, isSystem, userCount, createdAt, updatedAt }`.

- [ ] **Step 1: Error codes and audit types**

Add to `ERROR_CODES`: `'ROLE_NAME_TAKEN', 'ROLE_IS_SYSTEM', 'ROLE_IN_USE', 'CANNOT_DEMOTE_SELF', 'USER_HAS_HISTORY', 'CANNOT_DELETE_SELF', 'TEAM_IN_USE'`. In `audit.service.ts` extend `AuditEntityType` with `'role'`; in `audit.dto.ts` add `'role'` to the `entityType` enum.

- [ ] **Step 2: DTOs**

`src/roles/roles.dto.ts`:

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ROLE_LEVELS } from '@/database/schema';

const zName = z.string().trim().min(2).max(40);
const zLevel = z.enum(ROLE_LEVELS);
export class CreateRoleDto extends createZodDto(z.object({ name: zName, level: zLevel })) {}
export class UpdateRoleDto extends createZodDto(z.object({ name: zName.optional(), level: zLevel.optional() })) {}
```

- [ ] **Step 3: Service**

Extend `RolesService`:

```ts
import { asc, count, eq, sql } from 'drizzle-orm';
import { AuditService } from '@/audit/audit.service';
import { DomainError, notFound } from '@/common/errors/domain-error';
import { uniqueViolationConstraint } from '@/common/errors/pg';
import { roles, users, RoleLevel } from '@/database/schema';
import { CreateRoleDto, UpdateRoleDto } from './roles.dto';

export interface RoleView { id: string; name: string; level: RoleLevel; isSystem: boolean; userCount: number; createdAt: Date; updatedAt: Date }

// constructor(private readonly drizzle: DrizzleService, private readonly audit: AuditService) {}

private viewQuery(db: DbOrTx = this.drizzle.db) {
  return db.select({
    id: roles.id, name: roles.name, level: roles.level, isSystem: roles.isSystem, createdAt: roles.createdAt, updatedAt: roles.updatedAt,
    userCount: sql<number>`(select count(*) from users u where u.role_id = ${roles.id})`.mapWith(Number),
  }).from(roles);
}

async list(): Promise<RoleView[]> { return this.viewQuery().orderBy(asc(roles.name)); }

async findById(id: string, db: DbOrTx = this.drizzle.db): Promise<RoleView> {
  const [r] = await this.viewQuery(db).where(eq(roles.id, id));
  if (!r) throw notFound('Role');
  return r;
}

async create(actorId: string, dto: CreateRoleDto): Promise<RoleView> {
  try {
    return await this.drizzle.db.transaction(async (tx) => {
      const [row] = await tx.insert(roles).values(dto).returning({ id: roles.id });
      const after = await this.findById(row.id, tx);
      await this.audit.record(tx, { actorId, action: 'role.created', entityType: 'role', entityId: row.id, after });
      return after;
    });
  } catch (err) { throw this.mapDbError(err); }
}

async update(actor: { id: string; roleId: string }, id: string, dto: UpdateRoleDto): Promise<RoleView> {
  try {
    return await this.drizzle.db.transaction(async (tx) => {
      const before = await this.findById(id, tx);
      if (dto.level !== undefined && dto.level !== before.level) {
        if (before.isSystem) throw new DomainError('ROLE_IS_SYSTEM', 'The level of a system role cannot be changed', 409);
        if (id === actor.roleId && dto.level !== 'admin') throw new DomainError('CANNOT_DEMOTE_SELF', 'You cannot remove admin level from your own role', 409);
      }
      await tx.update(roles).set({ ...dto, updatedAt: new Date() }).where(eq(roles.id, id));
      const after = await this.findById(id, tx);
      await this.audit.record(tx, { actorId: actor.id, action: 'role.updated', entityType: 'role', entityId: id, before, after });
      return after;
    });
  } catch (err) { throw this.mapDbError(err); }
}

async remove(actorId: string, id: string): Promise<void> {
  await this.drizzle.db.transaction(async (tx) => {
    const before = await this.findById(id, tx);
    if (before.isSystem) throw new DomainError('ROLE_IS_SYSTEM', 'System roles cannot be deleted', 409);
    if (before.userCount > 0) throw new DomainError('ROLE_IN_USE', `${before.userCount} user(s) still have this role`, 409);
    await tx.delete(roles).where(eq(roles.id, id));
    await this.audit.record(tx, { actorId, action: 'role.deleted', entityType: 'role', entityId: id, before });
  });
}

private mapDbError(err: unknown): unknown {
  if (uniqueViolationConstraint(err) === 'roles_name_idx') return new DomainError('ROLE_NAME_TAKEN', 'A role with this name already exists', 409);
  return err;
}
```

`roles.module.ts`: add `controllers: [RolesController]`. `AuditModule` is `@Global()`, so `AuditService` injects without an import.

- [ ] **Step 4: Controller**

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { Levels } from '@/common/auth/levels.decorator';
import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRoleDto } from './roles.dto';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}
  @Get() async list() { return { data: await this.roles.list() }; }
  @Post() @Levels('admin') async create(@CurrentUser() actor: AuthUser, @Body() dto: CreateRoleDto) { return { data: await this.roles.create(actor.id, dto) }; }
  @Patch(':id') @Levels('admin') async update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) { return { data: await this.roles.update(actor, id, dto) }; }
  @Delete(':id') @Levels('admin') @HttpCode(204) async remove(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) { await this.roles.remove(actor.id, id); }
}
```

- [ ] **Step 5: Tests**

`test/roles.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createRole, systemRoleId } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { auditLog, roles } from '@/database/schema';

describe('roles', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let adminToken: string; let admin: Awaited<ReturnType<typeof createUser>>;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await truncateAll(db);
    admin = await createUser(db, { role: 'admin' }); adminToken = (await login(app, admin.email, admin.password)).accessToken;
  });
  const post = (payload: unknown, token = adminToken) => app.inject({ method: 'POST', url: '/api/v1/roles', headers: bearer(token), payload });

  it('lists the six system roles with user counts for any signed-in user', async () => {
    const emp = await createUser(db); const token = (await login(app, emp.email, emp.password)).accessToken;
    const res = await app.inject({ method: 'GET', url: '/api/v1/roles', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const names = res.json().data.map((r: { name: string }) => r.name);
    expect(names).toEqual(['Admin', 'CTO', 'Delivery Manager', 'Employee', 'Finance', 'Tech Lead']);
    expect(res.json().data.find((r: { name: string }) => r.name === 'Employee')).toMatchObject({ level: 'employee', isSystem: true, userCount: 1 });
  });

  it('admin creates, renames and deletes a custom role with audit entries', async () => {
    const created = await post({ name: 'QA Lead', level: 'manager' });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ name: 'QA Lead', level: 'manager', isSystem: false, userCount: 0 });
    const id = created.json().data.id;
    const renamed = await app.inject({ method: 'PATCH', url: `/api/v1/roles/${id}`, headers: bearer(adminToken), payload: { name: 'QA Manager', level: 'finance' } });
    expect(renamed.json().data).toMatchObject({ name: 'QA Manager', level: 'finance' });
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/roles/${id}`, headers: bearer(adminToken) })).statusCode).toBe(204);
    const actions = (await db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, id))).map((r) => r.a).sort();
    expect(actions).toEqual(['role.created', 'role.deleted', 'role.updated']);
  });

  it('rejects names that differ only by case', async () => {
    const res = await post({ name: 'admin', level: 'employee' });
    expect(res.statusCode).toBe(409); expect(res.json().code).toBe('ROLE_NAME_TAKEN');
  });

  it('system roles can be renamed but not re-levelled or deleted', async () => {
    const adminRoleId = await systemRoleId(db, 'admin');
    const ok = await app.inject({ method: 'PATCH', url: `/api/v1/roles/${adminRoleId}`, headers: bearer(adminToken), payload: { name: 'Administrator' } });
    expect(ok.statusCode).toBe(200);
    const level = await app.inject({ method: 'PATCH', url: `/api/v1/roles/${adminRoleId}`, headers: bearer(adminToken), payload: { level: 'employee' } });
    expect(level.json().code).toBe('ROLE_IS_SYSTEM');
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/roles/${adminRoleId}`, headers: bearer(adminToken) });
    expect(del.json().code).toBe('ROLE_IS_SYSTEM');
    await db.update(roles).set({ name: 'Admin' }).where(eq(roles.id, adminRoleId));
  });

  it('a role with users cannot be deleted', async () => {
    const r = await createRole(db, { name: 'Temp', level: 'employee' });
    await createUser(db, { roleId: r.id });
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/roles/${r.id}`, headers: bearer(adminToken) });
    expect(del.statusCode).toBe(409); expect(del.json().code).toBe('ROLE_IN_USE');
  });

  it('an admin cannot demote their own custom role', async () => {
    const r = await createRole(db, { name: 'Super', level: 'admin' });
    const me = await createUser(db, { roleId: r.id }); const token = (await login(app, me.email, me.password)).accessToken;
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/roles/${r.id}`, headers: bearer(token), payload: { level: 'manager' } });
    expect(res.json().code).toBe('CANNOT_DEMOTE_SELF');
  });

  it('non-admins cannot create roles', async () => {
    const emp = await createUser(db); const token = (await login(app, emp.email, emp.password)).accessToken;
    expect((await post({ name: 'X', level: 'employee' }, token)).statusCode).toBe(403);
  });
});
```

- [ ] **Step 6: Run and commit**

Run: `pnpm lint && pnpm vitest run test/roles.e2e.spec.ts && pnpm test`

```bash
git add -A && git commit -m "feat(roles): CRUD endpoints with system/in-use/self-demotion guards"
```

---

### Task 5: Delete users

**Files:**
- Modify: `src/users/users.service.ts`, `src/users/users.controller.ts`
- Test: `test/users-delete.e2e.spec.ts`

**Interfaces:**
- Produces: `DELETE /users/:id` (admin) → 204; 409 `USER_HAS_HISTORY` / `CANNOT_DELETE_SELF`; 404 when unknown.

- [ ] **Step 1: Service**

Add to `UsersService` (import `sql` from drizzle-orm):

```ts
async remove(actorId: string, id: string): Promise<void> {
  if (actorId === id) throw new DomainError('CANNOT_DELETE_SELF', 'You cannot delete your own account', 409);
  await this.drizzle.db.transaction(async (tx) => {
    const [row] = await usersWithRole(tx).where(eq(users.id, id));
    if (!row) throw notFound('User');
    const res = await tx.execute<{ has_history: boolean }>(sql`
      select (
        exists(select 1 from sheets where employee_id = ${id} or paid_by_id = ${id})
        or exists(select 1 from sheet_entries where requested_by_id = ${id})
        or exists(select 1 from attachments where owner_id = ${id})
        or exists(select 1 from sheet_approval_steps where approver_id = ${id} or backup_approver_id = ${id} or decided_by_id = ${id})
        or exists(select 1 from audit_log where actor_id = ${id})
        or exists(select 1 from approval_chain_steps where approver_id = ${id} or backup_approver_id = ${id})
        or exists(select 1 from teams where tech_lead_id = ${id})
      ) as has_history`);
    if (res.rows[0]?.has_history) throw new DomainError('USER_HAS_HISTORY', 'This user has history (sheets, approvals or audit entries). Deactivate them instead.', 409);
    await tx.delete(users).where(eq(users.id, id)); // notifications and tokens cascade
    await this.audit.record(tx, { actorId, action: 'user.deleted', entityType: 'user', entityId: id, before: toPublicUser(row) });
  });
}
```

Controller: `@Delete(':id') @HttpCode(204) async remove(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) { await this.users.remove(actor.id, id); }` (import `Delete`).

- [ ] **Step 2: Tests**

`test/users-delete.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam, createChain, createSheet, createEntry, createOvertimeType } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { auditLog, notifications, sheetApprovalSteps, sheetEntries, sheets, users } from '@/database/schema';

describe('delete users', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let adminToken: string; let admin: Awaited<ReturnType<typeof createUser>>;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); admin = await createUser(db, { role: 'admin' }); adminToken = (await login(app, admin.email, admin.password)).accessToken; });
  const del = (id: string) => app.inject({ method: 'DELETE', url: `/api/v1/users/${id}`, headers: bearer(adminToken) });

  it('deletes a fresh user and cascades notifications; audit keeps the email', async () => {
    const u = await createUser(db, { email: 'fresh@t.local' });
    await db.insert(notifications).values({ userId: u.id, type: 'sheet.submitted', title: 't', body: 'b', link: '/x' });
    expect((await del(u.id)).statusCode).toBe(204);
    expect(await db.select().from(users).where(eq(users.id, u.id))).toHaveLength(0);
    expect(await db.select().from(notifications).where(eq(notifications.userId, u.id))).toHaveLength(0);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.entityId, u.id));
    expect(entry.action).toBe('user.deleted');
    expect((entry.before as { email: string }).email).toBe('fresh@t.local');
  });

  it('refuses self-delete and unknown ids', async () => {
    expect((await del(admin.id)).json().code).toBe('CANNOT_DELETE_SELF');
    expect((await del('00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);
  });

  const expectHistory = async (id: string) => { const r = await del(id); expect(r.statusCode).toBe(409); expect(r.json().code).toBe('USER_HAS_HISTORY'); };

  it('refuses when the user owns a sheet', async () => { const u = await createUser(db); await createSheet(db, u.id); await expectHistory(u.id); });
  it('refuses when the user is a backup approver on a chain', async () => {
    const lead = await createUser(db); const backup = await createUser(db); const t = await createTeam(db);
    await createChain(db, t.id, [{ label: 'TL', approverId: lead.id, backupApproverId: backup.id }]);
    await expectHistory(backup.id);
  });
  it('refuses when the user decided a step', async () => {
    const emp = await createUser(db); const sheet = await createSheet(db, emp.id); const approver = await createUser(db); const decider = await createUser(db);
    await db.insert(sheetApprovalSteps).values({ sheetId: sheet.id, round: 1, position: 1, label: 'TL', approverId: approver.id, status: 'approved', decidedById: decider.id, decidedAt: new Date() });
    await expectHistory(decider.id);
  });
  it('refuses when the user is a tech lead', async () => { const lead = await createUser(db); await createTeam(db, { techLeadId: lead.id }); await expectHistory(lead.id); });
  it('refuses when the user requested an entry', async () => {
    const emp = await createUser(db); const mgr = await createUser(db); const type = await createOvertimeType(db); const sheet = await createSheet(db, emp.id);
    const e = await createEntry(db, sheet.id, type.id); await db.update(sheetEntries).set({ requestedById: mgr.id }).where(eq(sheetEntries.id, e.id));
    await expectHistory(mgr.id);
  });
  it('refuses when the user has audit entries as actor', async () => {
    const other = await createUser(db, { role: 'admin' }); const token = (await login(app, other.email, other.password)).accessToken;
    await app.inject({ method: 'POST', url: '/api/v1/teams', headers: bearer(token), payload: { name: 'Audit team' } });
    await expectHistory(other.id);
  });
  it('refuses when the user paid a sheet', async () => {
    const emp = await createUser(db); const payer = await createUser(db); const s = await createSheet(db, emp.id);
    await db.update(sheets).set({ paidById: payer.id }).where(eq(sheets.id, s.id));
    await expectHistory(payer.id);
  });
  it('non-admins get 403', async () => {
    const emp = await createUser(db); const token = (await login(app, emp.email, emp.password)).accessToken; const victim = await createUser(db);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/users/${victim.id}`, headers: bearer(token) })).statusCode).toBe(403);
  });
});
```

If the `notifications` or `sheetApprovalSteps` column names in the fixtures above differ from `src/database/schema`, use the schema's names; the assertions are what matter.

- [ ] **Step 3: Run and commit**

Run: `pnpm lint && pnpm vitest run test/users-delete.e2e.spec.ts && pnpm test`

```bash
git add -A && git commit -m "feat(users): guarded hard delete"
```

---

### Task 6: Delete teams, README and Swagger check

**Files:**
- Modify: `src/teams/teams.service.ts`, `src/teams/teams.controller.ts`, `README.md`
- Test: `test/teams-delete.e2e.spec.ts`

**Interfaces:**
- Produces: `DELETE /teams/:id` (admin) → 204; 409 `TEAM_IN_USE`; chain steps cascade.

- [ ] **Step 1: Service and controller**

`teams.service.ts`:

```ts
async remove(actorId: string, id: string): Promise<void> {
  await this.drizzle.db.transaction(async (tx) => {
    const before = await this.findById(id, tx);
    const res = await tx.execute<{ in_use: boolean }>(sql`
      select (exists(select 1 from users where team_id = ${id}) or exists(select 1 from sheets where team_id = ${id})) as in_use`);
    if (res.rows[0]?.in_use) throw new DomainError('TEAM_IN_USE', 'This team still has members or sheets. Move the members first, or deactivate the team.', 409);
    await tx.delete(teams).where(eq(teams.id, id)); // approval_chain_steps cascade
    await this.audit.record(tx, { actorId, action: 'team.deleted', entityType: 'team', entityId: id, before });
  });
}
```

Controller: `@Delete(':id') @Levels('admin') @HttpCode(204) async remove(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) { await this.teams.remove(actor.id, id); }`.

- [ ] **Step 2: Tests**

`test/teams-delete.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam, createChain, createSheet } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { approvalChainSteps, teams, users } from '@/database/schema';

describe('delete teams', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let adminToken: string;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); const a = await createUser(db, { role: 'admin' }); adminToken = (await login(app, a.email, a.password)).accessToken; });
  const del = (id: string) => app.inject({ method: 'DELETE', url: `/api/v1/teams/${id}`, headers: bearer(adminToken) });

  it('deletes an empty team and its chain', async () => {
    const lead = await createUser(db); const t = await createTeam(db);
    await createChain(db, t.id, [{ label: 'TL', approverId: lead.id }]);
    expect((await del(t.id)).statusCode).toBe(204);
    expect(await db.select().from(teams).where(eq(teams.id, t.id))).toHaveLength(0);
    expect(await db.select().from(approvalChainSteps).where(eq(approvalChainSteps.teamId, t.id))).toHaveLength(0);
  });

  it('refuses when a member exists', async () => {
    const t = await createTeam(db); await createUser(db, { teamId: t.id });
    const r = await del(t.id); expect(r.statusCode).toBe(409); expect(r.json().code).toBe('TEAM_IN_USE');
  });

  it('refuses when only a sheet snapshot references the team', async () => {
    const t = await createTeam(db); const emp = await createUser(db, { teamId: t.id });
    await createSheet(db, emp.id); await db.update(users).set({ teamId: null }).where(eq(users.id, emp.id));
    expect((await del(t.id)).json().code).toBe('TEAM_IN_USE');
  });

  it('404 for unknown and 403 for non-admin', async () => {
    expect((await del('00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);
    const emp = await createUser(db); const token = (await login(app, emp.email, emp.password)).accessToken; const t = await createTeam(db);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/teams/${t.id}`, headers: bearer(token) })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 3: README and Swagger**

README, after the roles paragraph from Task 3, add:

```
Admins can delete users and teams that have no history (`DELETE /users/:id`, `DELETE /teams/:id`). A user with sheets,
approvals, chain membership or audit entries returns 409 `USER_HAS_HISTORY`: deactivate them instead. A team with members or
sheets returns 409 `TEAM_IN_USE`.
```

Start the API (`rm -rf dist && pnpm build && node dist/main.js` with the dev `.env`, Postgres running) and confirm `http://localhost:3000/docs-json` lists `/api/v1/roles` and the two DELETE routes. Stop it afterwards.

- [ ] **Step 4: Run and commit**

Run: `pnpm lint && pnpm test`
Expected: ≥ 132 + new tests, all green.

```bash
git add -A && git commit -m "feat(teams): guarded hard delete; docs for roles and deletes"
```
