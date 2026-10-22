# Google sign-in and employee import (API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Google ID-token login endpoint, an optional `department` field on users with a list filter, and a re-runnable CLI that imports employees from the HR `.xlsx` export.

**Architecture:** Google sign-in is a second way to obtain the existing session: a public endpoint verifies a Google ID token through an injectable verifier (stubbed in tests) and issues the same access token and refresh cookie as password login. The import is a Nest application-context script like `create-admin`, split into a dependency-light xlsx reader and a validate-then-write importer that is all-or-nothing. Department is one nullable text column threaded through DTOs, list filter and a distinct-values endpoint.

**Tech Stack:** NestJS 11 + Fastify, Drizzle ORM + PostgreSQL 16, nestjs-zod, vitest + testcontainers, `google-auth-library`, `fflate`.

**Spec:** `docs/superpowers/specs/2026-10-20-google-sso-and-employee-import-design.md` (sections 3.2, 3.5, 4, 5, 6)

**Companion plan:** `2026-10-20-google-sso-web.md` (web repo work; consumes the endpoints defined here)

## Global Constraints

- New runtime dependencies limited to `google-auth-library` and `fflate`.
- No names, emails or codes from the real HR file anywhere in code, tests, fixtures or docs. Test data is made up.
- Password login, invite, reset and `create-admin` are not changed in behaviour.
- Migrations are hand-written SQL in `drizzle/` with a `_journal.json` entry, as 0002 to 0004 were (no snapshot file). Next number is `0005`.
- Error codes are added to `ERROR_CODES` in `src/common/errors/domain-error.ts`; responses use `DomainError` and the `{ data }` envelope.
- Existing style: compact one-line DTOs, `usersWithRole` + `toPublicUser` for user rows, `truncateAll` + factories in e2e tests.
- Run `pnpm lint` and `pnpm test` green before each commit.

## Review Focus

1. Google token whose email differs only in case from the stored email must sign in (Task 2 test "matches email case-insensitively").
2. Google token with `email_verified` false must be rejected with 401 `GOOGLE_TOKEN_INVALID`, not signed in (Task 2 test "rejects unverified email").
3. An imported user (no password) who tries the password form gets 401 `INVALID_CREDENTIALS`, not a 500 (Task 4 test "imported users cannot password-login").
4. Excel exports often carry trailing rows whose cells are all empty; the reader must drop them rather than the importer reporting "invalid email" on row 128 (Task 3 test "skips fully empty rows").
5. `PATCH /users/:id` with `department: ""` must store `null`, matching how `employeeCode` is normalised, so the filter dropdown never shows an empty entry (Task 1 test "empty department becomes null").

---

### Task 1: Department column, filter and distinct list

**Files:**
- Modify: `src/database/schema/users-teams.ts` (users table)
- Create: `drizzle/0005_user_department.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/users/users.dto.ts`
- Modify: `src/users/users.service.ts:50-63` (list) and add `departments()`
- Modify: `src/users/users.controller.ts`
- Modify: `test/helpers/factories.ts` (`createUser` option `department`)
- Test: `test/users.e2e.spec.ts`

**Interfaces:**
- Produces: `users.department: text | null` column; `CreateUserDto.department?: string | null`, `UpdateUserDto.department?: string | null`, `ListUsersQueryDto.department?: string`; `UsersService.departments(): Promise<string[]>`; `GET /api/v1/users/departments` → `{ data: string[] }`; `PublicUser.department: string | null` (flows through `toPublicUser` automatically).

- [ ] **Step 1: Write the failing tests** in `test/users.e2e.spec.ts`, inside the existing `describe('users')`:

```ts
it('stores department on create, clears it on PATCH with empty string, filters case-insensitively', async () => {
  const roleId = await systemRoleId(db, 'employee');
  const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: bearer(adminToken), payload: { firstName: 'Dee', lastName: 'P', email: 'dee@t.local', roleId, department: ' Engineering ' } });
  expect(res.statusCode).toBe(201); expect(res.json().data.department).toBe('Engineering');
  await createUser(db, { email: 'eng2@t.local', department: 'engineering' }); await createUser(db, { email: 'des@t.local', department: 'Design' });
  const list = await app.inject({ method: 'GET', url: '/api/v1/users?department=ENGINEERING', headers: bearer(adminToken) });
  expect(list.json().data.map((u: { email: string }) => u.email).sort()).toEqual(['dee@t.local', 'eng2@t.local']);
  const cleared = await app.inject({ method: 'PATCH', url: `/api/v1/users/${res.json().data.id}`, headers: bearer(adminToken), payload: { department: '' } });
  expect(cleared.statusCode).toBe(200); expect(cleared.json().data.department).toBeNull();
});

it('lists distinct departments, de-duplicated case-insensitively and sorted', async () => {
  await createUser(db, { department: 'engineering' }); await createUser(db, { department: 'Engineering' }); await createUser(db, { department: 'Design' }); await createUser(db);
  const res = await app.inject({ method: 'GET', url: '/api/v1/users/departments', headers: bearer(adminToken) });
  expect(res.statusCode).toBe(200); expect(res.json().data.map((s: string) => s.toLowerCase())).toEqual(['design', 'engineering']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/users.e2e.spec.ts -t department`
Expected: FAIL (department missing from response; `/users/departments` returns 400 from `ParseUUIDPipe`).

- [ ] **Step 3: Add the column and migration**

In `users-teams.ts` add `department: text('department'),` after `employeeCode`. Create `drizzle/0005_user_department.sql` containing `ALTER TABLE "users" ADD COLUMN "department" text;`. Append to `_journal.json` entries: `{ "idx": 5, "version": "7", "when": 1792500300000, "tag": "0005_user_department", "breakpoints": true }`.

- [ ] **Step 4: Extend the DTOs**

Add to `CreateUserDto` and `UpdateUserDto`: `department: z.string().trim().max(60).nullable().optional().transform((v) => (v === '' ? null : v))` (empty string becomes `null`; an absent field stays `undefined`, so PATCH without it does not clear the value). Add to `ListUsersQueryDto`: `department: z.string().trim().min(1).optional()`.

- [ ] **Step 5: Implement filter and `departments()`**

In `UsersService.list`, add `if (q.department) where.push(sql\`lower(${users.department}) = lower(${q.department})\`);`. Add `async departments(): Promise<string[]>` returning `select min(department) as d from users where department is not null group by lower(department) order by lower(min(department))` mapped to strings (which casing wins within a group is unspecified; the test only checks case-insensitive equality). In `UsersController`, add `@Get('departments') async departments() { return { data: await this.users.departments() }; }` **before** `@Get(':id')`. In `createUser` factory, add `department?: string | null` passed through to the insert.

- [ ] **Step 6: Run the tests to verify they pass, then the full suite**

Run: `pnpm vitest run test/users.e2e.spec.ts` then `pnpm test && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add drizzle src/database/schema/users-teams.ts src/users test/helpers/factories.ts test/users.e2e.spec.ts
git commit -m "feat(users): optional department with list filter and distinct endpoint (migration 0005)"
```

---

### Task 2: Google sign-in endpoint

**Files:**
- Modify: `src/common/config/env.ts` (add `GOOGLE_CLIENT_ID: z.string().min(1).optional()`)
- Modify: `src/common/errors/domain-error.ts` (add `'GOOGLE_SIGNIN_DISABLED', 'GOOGLE_TOKEN_INVALID', 'GOOGLE_ACCOUNT_UNKNOWN'`)
- Create: `src/auth/google-token.verifier.ts`
- Modify: `src/auth/auth.service.ts` (extract `issueSession`, add `loginWithGoogle`)
- Modify: `src/auth/auth.dto.ts` (`GoogleLoginDto`)
- Modify: `src/auth/auth.controller.ts` (`POST auth/google`)
- Modify: `src/auth/auth.module.ts` (provide `GoogleTokenVerifier`)
- Modify: `test/helpers/app.ts` (`createTestApp(configure?)`)
- Modify: `.env.example`, `docker-compose.prod.yml`, `README.md`
- Test: `test/auth-google.e2e.spec.ts`

**Interfaces:**
- Produces: `interface GoogleIdentity { email: string; emailVerified: boolean }`; `class GoogleTokenVerifier { verify(credential: string): Promise<GoogleIdentity> }`; `AuthService.loginWithGoogle(credential: string): Promise<{ accessToken; refresh; user }>` (same shape as `login`); `POST /api/v1/auth/google` body `{ credential: string }` → `200 { data: { accessToken, user } }` + `ot_refresh` cookie; errors `503 GOOGLE_SIGNIN_DISABLED`, `401 GOOGLE_TOKEN_INVALID`, `403 GOOGLE_ACCOUNT_UNKNOWN`, `401 USER_INACTIVE`.
- `createTestApp(configure?: (b: TestingModuleBuilder) => TestingModuleBuilder)` for provider overrides.

- [ ] **Step 1: Install the dependency**

Run: `pnpm add google-auth-library`

- [ ] **Step 2: Write the failing tests** in `test/auth-google.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { DomainError } from '@/common/errors/domain-error';
import { GoogleTokenVerifier, GoogleIdentity } from '@/auth/google-token.verifier';

const identities = new Map<string, GoogleIdentity>(); // credential -> identity
const stub = { verify: async (c: string) => { const id = identities.get(c); if (!id) throw new DomainError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed, try again', 401); return id; } };
const google = (app: NestFastifyApplication, credential: string) => app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential } });

describe('auth/google', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  beforeAll(async () => { process.env.GOOGLE_CLIENT_ID = 'test-client-id'; app = await createTestApp((b) => b.overrideProvider(GoogleTokenVerifier).useValue(stub)); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); delete process.env.GOOGLE_CLIENT_ID; });
  beforeEach(async () => { await truncateAll(db); identities.clear(); });

  it('signs in a known, active user and sets the refresh cookie', async () => {
    const u = await createUser(db, { email: 'g@t.local' }); identities.set('good-token', { email: 'g@t.local', emailVerified: true });
    const res = await google(app, 'good-token');
    expect(res.statusCode).toBe(200); expect(res.json().data.accessToken).toBeTypeOf('string'); expect(res.json().data.user.id).toBe(u.id);
    expect(res.cookies.find((c) => c.name === 'ot_refresh')).toBeDefined();
  });
  it('matches email case-insensitively', async () => {
    await createUser(db, { email: 'case@t.local' }); identities.set('tok', { email: 'Case@T.local', emailVerified: true });
    expect((await google(app, 'tok')).statusCode).toBe(200);
  });
  it('rejects an invalid token with 401 GOOGLE_TOKEN_INVALID', async () => {
    const res = await google(app, 'nope-nope-nope'); expect(res.statusCode).toBe(401); expect(res.json().code).toBe('GOOGLE_TOKEN_INVALID');
  });
  it('rejects unverified email', async () => {
    await createUser(db, { email: 'unv@t.local' }); identities.set('unv', { email: 'unv@t.local', emailVerified: false });
    const res = await google(app, 'unv'); expect(res.statusCode).toBe(401); expect(res.json().code).toBe('GOOGLE_TOKEN_INVALID');
  });
  it('rejects an unknown address with 403 GOOGLE_ACCOUNT_UNKNOWN', async () => {
    identities.set('stranger', { email: 'who@t.local', emailVerified: true });
    const res = await google(app, 'stranger'); expect(res.statusCode).toBe(403); expect(res.json().code).toBe('GOOGLE_ACCOUNT_UNKNOWN');
    expect(res.json().message).toBe('No OverTrack account for this Google address. Ask your admin.');
  });
  it('rejects an inactive user with 401 USER_INACTIVE', async () => {
    await createUser(db, { email: 'off@t.local', isActive: false }); identities.set('off', { email: 'off@t.local', emailVerified: true });
    const res = await google(app, 'off'); expect(res.statusCode).toBe(401); expect(res.json().code).toBe('USER_INACTIVE');
  });
  it('validates the body', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: 'short' } })).statusCode).toBe(400);
  });
});

describe('auth/google when GOOGLE_CLIENT_ID is unset', () => {
  it('returns 503 GOOGLE_SIGNIN_DISABLED', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const app = await createTestApp();
    const res = await google(app, 'anything-long-enough'); expect(res.statusCode).toBe(503); expect(res.json().code).toBe('GOOGLE_SIGNIN_DISABLED');
    await app.close();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run test/auth-google.e2e.spec.ts`
Expected: FAIL (module `@/auth/google-token.verifier` not found).

- [ ] **Step 4: Extend `createTestApp`**

Signature: `createTestApp(configure?: (b: TestingModuleBuilder) => TestingModuleBuilder)`. Apply `configure` to the builder before `.compile()`. Import `TestingModuleBuilder` from `@nestjs/testing`.

- [ ] **Step 5: Implement `GoogleTokenVerifier`** in `src/auth/google-token.verifier.ts`

`@Injectable() export class GoogleTokenVerifier` with constructor `(config: ConfigService<Env, true>)`. `async verify(credential: string): Promise<GoogleIdentity>`: build `new OAuth2Client(clientId)` once (lazily, cached on the instance), call `verifyIdToken({ idToken: credential, audience: clientId })`, read `getPayload()`. Any thrown error, missing payload, or missing `email` → `throw new DomainError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed, try again', 401)`. Return `{ email: payload.email, emailVerified: payload.email_verified === true }`. (The disabled check lives in the service, not here, so the stub in tests never has to know the client id.)

- [ ] **Step 6: Implement `loginWithGoogle` and share session issuing**

In `AuthService`: add constructor param `private readonly google: GoogleTokenVerifier` and `private readonly config: ConfigService<Env, true>`. Extract from `login` a private `async issueSession(row: UserWithRole)` that does the inactive check, issues the access token and refresh token and returns `{ accessToken, refresh, user: toPublicUser(row) }`; `login` keeps the credential check and calls it. Add:

```ts
async loginWithGoogle(credential: string) {
  if (!this.config.get('GOOGLE_CLIENT_ID')) throw new DomainError('GOOGLE_SIGNIN_DISABLED', 'Google sign-in is not configured', 503);
  const id = await this.google.verify(credential);
  if (!id.emailVerified) throw new DomainError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed, try again', 401);
  const [row] = await usersWithRole(this.drizzle.db).where(eq(users.email, id.email.toLowerCase()));
  if (!row) throw new DomainError('GOOGLE_ACCOUNT_UNKNOWN', 'No OverTrack account for this Google address. Ask your admin.', 403);
  return this.issueSession(row);
}
```

Add `GoogleLoginDto extends createZodDto(z.object({ credential: z.string().min(10) }))`. Controller: `@Public() @Post('auth/google') @HttpCode(200)` mirroring `login` (set cookie, return `{ data: { accessToken, user } }`). Register `GoogleTokenVerifier` in `AuthModule.providers`. Add the three error codes and the optional env var.

- [ ] **Step 7: Run the tests to verify they pass, then the full suite**

Run: `pnpm vitest run test/auth-google.e2e.spec.ts test/auth.e2e.spec.ts` then `pnpm test && pnpm lint`
Expected: PASS, with `auth.e2e.spec.ts` unchanged and green.

- [ ] **Step 8: Config and docs**

`.env.example`: add `# GOOGLE_CLIENT_ID=...apps.googleusercontent.com` with a one-line comment "optional; enables POST /auth/google". `docker-compose.prod.yml` api environment: `GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}`. `README.md`: new section `## Google sign-in` after `## Production` containing the four setup steps from spec 3.5 verbatim in substance (Web application client, authorized JavaScript origins = web origins, no redirect URIs, Internal vs External consent screen trade-off, set `GOOGLE_CLIENT_ID` on the API and `VITE_GOOGLE_CLIENT_ID` on the web, client secret unused).

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/auth src/common test/helpers/app.ts test/auth-google.e2e.spec.ts .env.example docker-compose.prod.yml README.md
git commit -m "feat(auth): Google ID-token sign-in endpoint"
```

---

### Task 3: Namespace-tolerant xlsx reader

**Files:**
- Create: `src/database/xlsx-reader.ts`
- Test: `src/database/xlsx-reader.spec.ts`

**Interfaces:**
- Produces: `export function readFirstSheet(file: Uint8Array): Record<string, string>[]` — one object per data row keyed by the header cell text (trimmed, original casing); every header key present on every row (`''` when the cell is empty); rows whose cells are all empty are dropped; throws `Error('Workbook has no header row')` when the sheet is empty.

- [ ] **Step 1: Install the dependency**

Run: `pnpm add fflate`

- [ ] **Step 2: Write the failing tests** in `src/database/xlsx-reader.spec.ts`

Two fixture builders inside the spec, no binary files:

- `standardXlsx()`: `exceljs` `Workbook`, sheet "Sheet1", rows `['Name', 'Email', 'Dept']`, `['Ann Lee', 'ann@x.test', 'Ops']`, `['Bob', 'bob@x.test', '']`, then two rows of `['', '', '']`, returned via `workbook.xlsx.writeBuffer()` as `Uint8Array`.
- `prefixedXlsx()`: `fflate.zipSync` of hand-written strings: `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml` (`<x:workbook xmlns:x=... xmlns:r=...><x:sheets><x:sheet name="Data" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`), `xl/_rels/workbook.xml.rels` (`rId1` → `/xl/worksheets/sheet1.xml`), `xl/sharedStrings.xml` with `<x:si><x:t>` entries for `Name`, `Email`, `Dept`, `Ann Lee`, `ann@x.test`, `Ops` and one entry split across two `<x:t>` runs (`Bo` + `b`), and `xl/worksheets/sheet1.xml` using `<x:row>`/`<x:c t="s">`/`<x:v>` for the same three logical rows, plus one cell `<x:c r="C3" t="inlineStr"><x:is><x:t>Design</x:t></x:is></x:c>` and one numeric `<x:c r="A4"><x:v>42</x:v></x:c>` on an otherwise empty row.

Tests:

```ts
it('reads a standard workbook by header name and skips fully empty rows', () => {
  expect(readFirstSheet(standardXlsx())).toEqual([{ Name: 'Ann Lee', Email: 'ann@x.test', Dept: 'Ops' }, { Name: 'Bob', Email: 'bob@x.test', Dept: '' }]);
});
it('reads an x:-prefixed workbook, joining split shared-string runs and inline strings', () => {
  expect(readFirstSheet(prefixedXlsx())).toEqual([{ Name: 'Ann Lee', Email: 'ann@x.test', Dept: 'Ops' }, { Name: 'Bob', Email: 'bob@x.test', Dept: 'Design' }, { Name: '42', Email: '', Dept: '' }]);
});
it('throws on an empty sheet', () => { expect(() => readFirstSheet(emptyXlsx())).toThrow('Workbook has no header row'); });
```

(`emptyXlsx()` is `standardXlsx` with no rows.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/database/xlsx-reader.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `readFirstSheet`** in `src/database/xlsx-reader.ts`

Approach: `unzipSync` the buffer; decode entries with `strFromU8`. Match element names with a prefix-tolerant pattern (`<(?:\w+:)?row\b`). Locate the first sheet: first `sheet` element in `xl/workbook.xml`, its `r:id`, resolved through `xl/_rels/workbook.xml.rels` `Target` (normalise a leading `/` or a relative `worksheets/...` to `xl/worksheets/...`); fall back to `xl/worksheets/sheet1.xml` if either file is missing. Shared strings: every `si`, concatenating all `t` runs. Cells: column letters from `r`, `t="s"` → shared string index, `t="inlineStr"` → `is/t` text, otherwise raw `v` text; decode the five XML entities. First row is the header; subsequent rows map column letter → header key; drop rows where every value is `''`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/database/xlsx-reader.spec.ts && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/database/xlsx-reader.ts src/database/xlsx-reader.spec.ts
git commit -m "feat(database): namespace-tolerant xlsx reader"
```

---

### Task 4: Employee import script

**Files:**
- Create: `src/database/import-employees.ts`
- Modify: `package.json` (script `"import-employees": "nest build && node dist/database/import-employees.js"`)
- Modify: `.gitignore` (add `*.xlsx`)
- Modify: `README.md` (`## First deploy` gains the internal-rollout path)
- Test: `test/import-employees.e2e.spec.ts`

**Interfaces:**
- Consumes: `readFirstSheet` (Task 3); `RolesService.ensureSystemRoles()`; `users.department` (Task 1).
- Produces: `export interface ImportOptions { adminEmail: string; dryRun?: boolean }`; `export interface ImportReport { created: string[]; skipped: string[]; problems: string[] }` (emails; problems are human-readable lines prefixed `row N:` or `file:`); `export async function importEmployees(app: INestApplicationContext, rows: Record<string, string>[], opts: ImportOptions): Promise<ImportReport>` — writes nothing when `problems.length > 0` or `dryRun`; CLI `pnpm import-employees <file.xlsx> --admin <email> [--dry-run]`, exit code 1 when problems exist.

- [ ] **Step 1: Write the failing tests** in `test/import-employees.e2e.spec.ts`

Setup like `create-admin.e2e.spec.ts` (`createTestApp`, `truncateAll` in `beforeEach`). Helper `row(n: string, e: string, name: string, dept = 'Ops')` → `{ EmployeeNumber: n, FullName: name, WorkEmail: e, JobTitle: '', Level: '', HireDate: '', Department: dept, Location: '' }`.

```ts
it('creates users with employee role, admin for --admin, names split at first space, email lowercased', async () => {
  const rows = [row('EMP-1', ' Root@X.test ', 'Rae  Ann  Root', 'IT'), row('7', 'sam@x.test', 'Sam Lee', '')];
  const r = await importEmployees(app, rows, { adminEmail: 'root@x.test' });
  expect(r).toEqual({ created: ['root@x.test', 'sam@x.test'], skipped: [], problems: [] });
  const all = await usersWithRole(db).orderBy(users.email);
  expect(all.map((x) => [x.user.email, x.user.firstName, x.user.lastName, x.user.employeeCode, x.user.department, x.role.level, x.user.passwordHash, x.user.teamId]))
    .toEqual([['root@x.test', 'Rae', 'Ann Root', 'EMP-1', 'IT', 'admin', null, null], ['sam@x.test', 'Sam', 'Lee', '7', null, 'employee', null, null]]);
});
it('re-run skips existing emails and never modifies them', async () => {
  const rows = [row('1', 'a@x.test', 'A One'), row('2', 'b@x.test', 'B Two')];
  await importEmployees(app, rows, { adminEmail: 'a@x.test' });
  const again = await importEmployees(app, [row('1', 'a@x.test', 'Changed Name'), row('3', 'c@x.test', 'C Three')], { adminEmail: 'a@x.test' });
  expect(again.created).toEqual(['c@x.test']); expect(again.skipped).toEqual(['a@x.test']);
  expect((await db.select().from(users).where(eq(users.email, 'a@x.test')))[0].firstName).toBe('A');
});
it('aborts without writing on duplicate email, duplicate code, one-word name, bad email, long code', async () => {
  const rows = [row('1', 'a@x.test', 'A One'), row('2', 'A@x.test', 'A Dup'), row('1', 'b@x.test', 'B Two'), row('3', 'c@x.test', 'Mononym'), row('4', 'not-an-email', 'D Four'), row('123456789012345678901', 'e@x.test', 'E Five')];
  const r = await importEmployees(app, rows, { adminEmail: 'a@x.test' });
  expect(r.created).toEqual([]);
  expect(r.problems).toEqual(['row 3: duplicate email a@x.test (also row 2)', 'row 4: duplicate employee code 1 (also row 2)', 'row 5: name must have at least two words', 'row 6: invalid email not-an-email', 'row 7: employee code longer than 20 characters']);
  expect(Number((await db.select({ n: count() }).from(users))[0].n)).toBe(0);
});
it('aborts when an employee code already belongs to another user', async () => {
  await createUser(db, { email: 'old@x.test', employeeCode: 'E9' });
  const r = await importEmployees(app, [row('E9', 'new@x.test', 'N New')], { adminEmail: 'new@x.test' });
  expect(r.problems).toEqual(['row 2: employee code E9 already belongs to old@x.test']); expect(r.created).toEqual([]);
});
it('aborts when --admin is not in the file', async () => {
  const r = await importEmployees(app, [row('1', 'a@x.test', 'A One')], { adminEmail: 'boss@x.test' });
  expect(r.problems).toEqual(['file: admin email boss@x.test not found in the sheet']);
});
it('dry run reports but writes nothing', async () => {
  const r = await importEmployees(app, [row('1', 'a@x.test', 'A One')], { adminEmail: 'a@x.test', dryRun: true });
  expect(r.created).toEqual(['a@x.test']); expect(Number((await db.select({ n: count() }).from(users))[0].n)).toBe(0);
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
```

Row numbers in messages are spreadsheet row numbers (header is row 1, first data row is row 2).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/import-employees.e2e.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `importEmployees`** in `src/database/import-employees.ts`

Required headers matched case-insensitively against the row keys: `EmployeeNumber`, `FullName`, `WorkEmail`, `Department`. Per-row normalisation: email `trim().toLowerCase()`, name `trim().replace(/\s+/g, ' ')` then split at first space, code `trim()`, department `trim() || null`. Validation order per row, one problem per row maximum, in the order the tests show: duplicate email (against earlier rows), duplicate code, name words, email regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, code length > 20, department length > 60 (`row N: department longer than 60 characters`). Then `file:` problems: admin email absent, missing headers (headers are checked first and short-circuit everything else). Then DB classification: existing emails → `skipped`; for the rest, codes already present on other users → `row N: employee code X already belongs to <email>`. Timezone from `ConfigService` `DEFAULT_TIMEZONE`. Inserts in one `db.transaction`. Role ids from `RolesService.ensureSystemRoles()`.

CLI (`require.main === module`): parse `process.argv` (positional path, `--admin <email>`, `--dry-run`); missing path or admin prints usage and exits 2. `readFileSync` → `readFirstSheet` → `NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })` → `importEmployees` → print `created N, skipped M (already existed)`, the skipped emails, and each problem on its own line; exit 1 if problems. Close the context in `finally`.

- [ ] **Step 4: Run the tests to verify they pass, then the full suite**

Run: `pnpm vitest run test/import-employees.e2e.spec.ts` then `pnpm test && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Script, gitignore, README**

Add the `import-employees` script. Add `*.xlsx` to `.gitignore`. In `README.md` under `## First deploy`, add a subsection `### Internal rollout from an HR export` with the three commands from spec 5.4 (fresh database, `pnpm db:migrate`, `pnpm import-employees <file.xlsx> --admin <your email>`), the column names the sheet must have, what the script does and does not do (no emails, no changes to existing users, all-or-nothing), and the manual follow-up in the admin UI (teams, tech leads, leadership roles, chains). Note that `create-admin` remains the break-glass path.

- [ ] **Step 6: Smoke-run the CLI against the local database**

Run: `pnpm import-employees /nonexistent.xlsx --admin a@b.co; echo "exit $?"`
Expected: a readable "file not found" error and `exit 1` (or 2), no stack trace.

- [ ] **Step 7: Commit**

```bash
git add src/database/import-employees.ts test/import-employees.e2e.spec.ts package.json .gitignore README.md
git commit -m "feat(database): employee import CLI from HR xlsx export"
```
