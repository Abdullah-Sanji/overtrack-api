# Google sign-in and employee import

**Date:** 2026-10-20
**Status:** approved in conversation, pending written review
**Parent specs:** `2026-10-18-overtrack-design.md`, `2026-10-19-overtrack-followups-design.md` (this document amends them; where they disagree, this one wins)
**Repos:** `over-track-api` (NestJS, Fastify, Drizzle, PostgreSQL), `over-track-web` (Vue 3, Pinia, TanStack Query, Tailwind v4, Reka UI)

## 1. Intent

OverTrack is being rolled out internally at a company of 126 people. The company runs on Google Workspace, so every employee already has a Google account on their work address. The admin has an Excel export of the HR system listing every employee.

Two things follow:

1. **Nobody should need an invitation email or a password.** The admin sends one email saying "go to OverTrack and sign in with Google". Users sign in with the Google button using their work address.
2. **The 126 employees are loaded once from the Excel file**, not created one by one in the admin UI. Teams, approval chains and leadership roles are then assigned by hand in the UI, because the HR export does not carry them.

The existing invite and password flows stay as they are. They remain the break-glass path for the admin, the path for anyone added by hand later, and the path the end-to-end tests use.

## 2. Goals, non-goals, anti-goals

**Goals**

1. A "Sign in with Google" button on the login page that signs in any active user whose email matches a Google account.
2. The password form stays available behind a small "Sign in with password" link.
3. A one-off, re-runnable import script that creates users from the HR Excel export.
4. A new optional `department` field on users, settable in the admin UI and usable as a filter in the admin users list, so manual team assignment after import is quick.

**Non-goals**

- No self sign-up. A Google account whose email is not already a user is rejected.
- No Google Workspace domain restriction. 12 of the 126 addresses are on other domains (aspire.com, gmail.com, ilabank.com, bank-abc.com); they are imported like everyone else. If an address is not a Google account, that person uses the invite path instead.
- No account linking by Google subject id. Email is the identity. (Workspace emails are stable; if one is renamed, the admin edits the user.)
- No One Tap prompt, no Google OAuth redirect flow, no refresh tokens from Google, no Google profile sync. Only the sign-in button and ID-token verification.
- No import of job title, level, hire date or location. Nothing in the app uses them.
- No team or role inference from department or job title.
- No UI for the import. It is a CLI script run by the admin.

**Anti-goals** (the result would be a failure even if everything works)

- Any user able to sign in with Google without an admin having created their account first.
- The import creating duplicate users or changing existing users on a re-run.
- The e2e suites (API and web) breaking or needing real Google credentials.
- The HR spreadsheet, or any rows from it, committed to either repository.

## 3. Google sign-in

### 3.1 Mechanism (my call)

The web app uses Google Identity Services (the `accounts.google.com/gsi/client` script) to render Google's own sign-in button. On success it hands the page a **credential**: a signed ID token (JWT). The web app posts that credential to the API. The API verifies it with Google's public keys, matches the email to an existing user, and issues the same access token and refresh cookie that password login issues. From then on the session is indistinguishable from a password session.

This was chosen over the redirect/authorization-code flow because the app needs nothing from Google except proof of email, it keeps the API stateless (no callback route, no state parameter, no session storage), and it fits the existing SPA + bearer token + refresh cookie design.

### 3.2 API

**Config.** New optional env var `GOOGLE_CLIENT_ID` (string, no default). Add to `envSchema` as optional, to `.env.example` (commented), and to `docker-compose.prod.yml` as `${GOOGLE_CLIENT_ID:-}`.

**Endpoint.** `POST /api/v1/auth/google`, public, body `{ credential: string }` (min length 10). It sits under `/api/v1/auth/`, so the existing per-route rate limit (10 per minute) applies automatically.

Behaviour, in order:

1. If `GOOGLE_CLIENT_ID` is unset: `503 GOOGLE_SIGNIN_DISABLED` "Google sign-in is not configured".
2. Verify the credential as a Google ID token with audience `GOOGLE_CLIENT_ID`. Use the official `google-auth-library` package (`OAuth2Client.verifyIdToken`). Any verification failure, including expired token, wrong audience, wrong issuer, or `email_verified !== true`: `401 GOOGLE_TOKEN_INVALID` "Google sign-in failed, try again".
3. Lowercase the token's `email` and look up the user with role (`usersWithRole`). Not found: `403 GOOGLE_ACCOUNT_UNKNOWN` "No OverTrack account for this Google address. Ask your admin." This is deliberately specific, unlike password login, because there is no credential-guessing risk: the caller has already proven they own the address.
4. Inactive user: `401 USER_INACTIVE` (existing code).
5. Issue access token and refresh token exactly as `AuthService.login` does, set the refresh cookie, return `{ data: { accessToken, user } }`.

**Structure (my call).** Put verification behind an injectable `GoogleTokenVerifier` class in `src/auth/google-token.verifier.ts` with one method, `verify(credential): Promise<{ email: string; emailVerified: boolean }>`. `AuthService.loginWithGoogle(credential)` depends on it. Tests override the provider with a stub, so no test touches Google. `AuthService.login` and `loginWithGoogle` share one private "issue session for this user row" helper so the inactive check and token issuing cannot drift.

**Audit log.** Password login is not audited today, so Google login is not either.

**Tests (`test/auth-google.e2e.spec.ts`).** Disabled when env unset; invalid token 401; unknown email 403; inactive 401; happy path returns access token, user and sets the refresh cookie; email case-insensitive match. Existing `auth.e2e.spec.ts` must still pass unchanged.

### 3.3 Web

**Config.** New optional `VITE_GOOGLE_CLIENT_ID`. Add to `.env.example`, and to the web `Dockerfile` as a build arg passed through from `docker-compose.prod.yml` the same way `VITE_API_URL` is.

**Login page.** Two modes, decided by whether `VITE_GOOGLE_CLIENT_ID` is set:

- **Set (production):** the card shows the Google button full width, with description "Sign in with your company Google account." Under the button, a small text link "Sign in with password". Clicking it reveals the existing email and password form in place (and hides the link; the Google button stays above). The reveal is not persisted. Google errors show in the same alert slot the form uses.
- **Unset (local dev, e2e):** the page looks exactly as it does today. No Google button, no link. This keeps Playwright e2e working without Google credentials.

**Google button.** A small composable `useGoogleIdentity()` in `src/features/auth/` that lazily injects the `gsi/client` script once, waits for `window.google`, calls `google.accounts.id.initialize({ client_id, callback })` and `renderButton` into a given element with `{ type: 'standard', size: 'large', width, text: 'signin_with', shape: 'rectangular' }`. Theme: `outline` in light mode, `filled_black` in dark mode (read the current theme the way the rest of the app does). Width is measured from the card so the button is as wide as the form. If the script fails to load within a few seconds, show "Google sign-in is unavailable" in the alert slot and auto-reveal the password form.

**Auth store.** New `loginWithGoogle(credential)` calling `authApi.loginWithGoogle` (`POST auth/google`), storing the access token and user exactly as `login` does. The redirect-after-login logic is shared with password login.

**Helmet / CSP.** The API disables CSP already; the web app is served by nginx without a CSP header. Nothing to change. If a CSP is ever added, it must allow `accounts.google.com` for script, frame and connect.

**Tests.** `LoginPage.spec.ts`: with client id set, the Google button container renders, the form is hidden until the link is clicked, and a Google error renders in the alert. With client id unset, the page is unchanged (existing assertions). Mock `window.google` in the spec; never load the real script. `auth.store.spec.ts`: `loginWithGoogle` stores the session.

### 3.4 Invite email wording (my call)

The invite email stays as it is: it is sent only for users created by hand through the admin UI, and those users set a password. The import sends no email. The admin's own "we are live" email to staff is outside the app.

### 3.5 Google Cloud setup (goes in the README)

1. Google Cloud console, the company's Workspace project (or a new one), APIs & Services, Credentials, Create credentials, OAuth client ID, type **Web application**.
2. Authorized JavaScript origins: the web app origin(s), e.g. `http://localhost:5173` for development and `https://overtrack.example.com` for production. No redirect URIs are needed for the button flow.
3. OAuth consent screen: user type **Internal** (Workspace only) is fine; external users on other domains then cannot use the Google button, which is acceptable per section 2, or choose **External** and publish to allow them. The admin decides; the README states both.
4. Copy the client ID into `GOOGLE_CLIENT_ID` (API) and `VITE_GOOGLE_CLIENT_ID` (web). The client secret is not used and should not be stored anywhere.

## 4. Department field

**Schema.** Migration `0005_user_department.sql`: `ALTER TABLE users ADD COLUMN department text;` Nullable, free text, no index (126 rows; filter is exact match).

**API.**

- `department: z.string().trim().min(1).max(60).nullable().optional()` on `CreateUserDto` and `UpdateUserDto`. Empty string from the form is normalised to `null` (same as `employeeCode`).
- `department` on `ListUsersQueryDto`; exact, case-insensitive match (`lower(department) = lower($1)`).
- `GET /api/v1/users/departments` (admin): `{ data: string[] }` of distinct non-null departments, case-insensitively de-duplicated, sorted. Used by the filter dropdown and the form's suggestions.
- `department` is part of `PublicUser` (it is a plain column, so `toPublicUser` already passes it through).
- Audit: department changes are captured by the existing user-update audit entry; no new event.

**Web.**

- `UsersPage`: a "Department" select next to Role and Status, options "All" plus the list from the new endpoint. A "Department" column after Team. The column hides at narrow widths the way other secondary columns do, if the table already has that behaviour; otherwise it is always shown (builder's call).
- `UserFormDrawer`: optional "Department" text input with `<datalist>` suggestions from the endpoint, placed after Team.

**Tests.** API `users.e2e.spec.ts`: create with department, update to null, list filter, departments endpoint de-dupes case. Web `UsersPage.spec.ts`: filter sends `department`; `UserFormDrawer.spec.ts`: field round-trips.

## 5. Employee import

### 5.1 The source file

The HR export is an `.xlsx` with one sheet and these header columns in row 1, in this order:

`EmployeeNumber, FullName, WorkEmail, JobTitle, Level, HireDate, Department, Location`

Facts about the actual file that the builder can rely on (verified 2026-10-20):

- 126 data rows. Every row has an employee number, full name, work email and department. Job title, level, hire date and location are sometimes blank.
- Employee numbers are free text up to 8 chars (`11`, `EMP-001`); all distinct.
- Emails are all distinct and syntactically valid; 3 have uppercase or surrounding whitespace.
- Full names are 2 to 5 words, sometimes separated by double spaces (`Ahmad Mohamed  Sied  Saleh`).
- Departments: Engineering, Human Capital, Design, Operations Support, Operations and Delivery, Commercial, Business, Finance, Operations, IT.
- The admin's own address, `abdallah@sitech.me`, is in the file.
- **The file is written by a .NET OpenXML library and prefixes every element with the `x:` namespace** (`<x:row>`, `<x:c>`, `<x:si>`, `<x:t>`). `exceljs` 4.4.0 (already a dependency) throws `Cannot read properties of undefined (reading 'sheets')` on it. The reader must handle both this form and the un-prefixed form Excel itself writes.

The file lives outside the repo (`~/Downloads/Employees_20261020.xlsx`) and must never be committed. Add `*.xlsx` under a `data/` or `imports/` pattern to `.gitignore` if the builder wants a conventional drop location.

### 5.2 Reader (my call)

Do not fight `exceljs`. Add `fflate` (tiny, zero-dependency) to unzip the workbook in memory, then read `xl/sharedStrings.xml` and the first worksheet listed in `xl/workbook.xml` with a namespace-tolerant parse: match element local names regardless of prefix (`(?:\w+:)?row`). Only three constructs are needed: shared strings (`si`/`t`, concatenating multiple `t` runs), rows, and cells with `t="s"` (shared string), `t="inlineStr"` (`is`/`t`) or a plain `v`. Dates and numbers are not needed, since those columns are ignored. Header row is matched by name, not position, case-insensitively, so column reordering in a future export does not break it. Unknown extra columns are ignored.

Put it in `src/database/xlsx-reader.ts` with a unit test that feeds it two fixtures: one generated in the test with `exceljs` (standard form) and one tiny checked-in file in the `x:`-prefixed form containing three made-up rows. Both must yield the same objects.

### 5.3 Script

`src/database/import-employees.ts`, exposed as `pnpm import-employees <file.xlsx> --admin <email> [--dry-run]` (script entry `nest build && node dist/database/import-employees.js`, mirroring `create-admin`). Refuses to run with `NODE_ENV=production`? **No.** Unlike the demo seed, this is the real production load. It runs in any environment.

Mapping per row:

| Sheet column | User field | Rule |
|---|---|---|
| WorkEmail | `email` | trim, lowercase |
| FullName | `firstName`, `lastName` | collapse whitespace runs to one space, trim; first word is `firstName`, the rest is `lastName` |
| EmployeeNumber | `employeeCode` | trim |
| Department | `department` | trim; blank becomes `null` |
| (none) | `roleId` | system role `employee`, except the `--admin` email which gets `admin` |
| (none) | `teamId` | `null` |
| (none) | `passwordHash` | `null` |
| (none) | `timezone` | `DEFAULT_TIMEZONE` from env |
| (none) | `isActive` | `true` |

Algorithm:

1. Boot a Nest application context (as `create-admin` does), call `RolesService.ensureSystemRoles()`.
2. Read all rows. Validate every row: email syntactically valid, first and last name non-empty after splitting (names of one word are rejected, with the row number), employee code at most 20 chars, department at most 60 chars. Detect duplicate emails and duplicate employee codes within the file. The `--admin` email must appear in the file.
3. Classify each row against the database: **create** (email not present), **skip** (email already present; the existing row is never modified, even if the sheet differs), or **conflict** (email not present but employee code already belongs to a different user).
4. If any validation error or conflict exists, print every problem with its row number and exit 1 **without writing anything**. The admin fixes the sheet and re-runs.
5. Otherwise insert all **create** rows in a single transaction. Print a summary: `created N, skipped M (already existed)`, and the list of skipped emails.
6. `--dry-run` does steps 1 to 4 and prints the summary of what would happen, without the transaction.

No invite emails, no notifications, no audit entries (there is no acting user; the script prints to stdout, and the admin can see created-at timestamps in the users list). No deletes: the script never removes or deactivates anyone, so people who leave the company are deactivated by hand.

**Tests (`test/import-employees.e2e.spec.ts`).** Against the test container: happy path creates with the right roles; re-run skips all and creates none; duplicate email in file aborts with nothing written; employee code conflict aborts with nothing written; `--admin` missing from file aborts; dry-run writes nothing; email case normalised; name splitting.

### 5.4 Going live (goes in the README)

Replaces the current "create-admin then seed" story for an internal rollout:

```
docker compose down -v && docker compose up -d
pnpm db:migrate
pnpm import-employees ~/Downloads/Employees_20261020.xlsx --admin abdallah@sitech.me
```

Then in the admin UI: create teams, pick each team's tech lead, set delivery manager / CTO / finance roles on the relevant people, build approval chains. The `create-admin` script remains documented as the break-glass way to get a password-holding admin on any environment.

## 6. Constraints

- Keep every existing API and web test green; the web e2e suites keep using the password form and must need no Google configuration.
- No new runtime dependency other than `google-auth-library` (API) and `fflate` (API). The web app adds no package; the GIS script is loaded from Google at runtime.
- Nothing from the HR file (names, emails, codes) appears in tests, fixtures, docs or commits. Test fixtures use made-up data.
- The password login path, invite flow, reset flow and `create-admin` script are not changed.
- Follow the existing code style (compact one-line DTOs, `DomainError` codes, `{ data }` envelopes, Drizzle migrations generated into `drizzle/` with the journal updated).

## 7. Left to the builder

- Exact look of the Google button container and the reveal link, within the existing `AuthCard` styling.
- Whether the department column in the users table is hidden on small screens.
- Whether the `departments` endpoint lives on `UsersController` or a tiny separate controller. If on `UsersController`, declare it before `@Get(':id')`, which uses `ParseUUIDPipe` and would otherwise swallow the route.
- Internal shape of the xlsx reader beyond the contract in 5.2.
- Order of the two repos' work. Suggested: API department field, API Google endpoint, import script, then web.
