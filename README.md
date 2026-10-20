# over-track-api

NestJS (Fastify) + Drizzle + PostgreSQL backend for overtime management.

## Run locally
```
docker compose up -d          # postgres + mailpit (mail UI at http://localhost:8025)
cp .env.example .env
pnpm install && pnpm db:migrate && pnpm seed
pnpm start:dev                # http://localhost:3000/docs
```

Seeded logins (password `Password123!`): `admin@overtrack.local`, `finance@overtrack.local`, `cto@overtrack.local`,
`tl.platform@overtrack.local`, `dm.platform@overtrack.local`, `emp1.platform@overtrack.local` ... `emp3.platform@overtrack.local`,
and the same pattern for `mobile` (`tl.mobile@`, `dm.mobile@`, `emp1.mobile@` ... `emp3.mobile@`).
Roles are data: six system roles (Employee, Tech Lead, Delivery Manager, CTO, Finance, Admin) are created on first start and
admins can add more under Admin → Roles. A role's *level* (employee, manager, finance, admin) decides permissions. System roles are identified by an internal key, so renaming them is safe.
Migration 0003 drops the old `user_role` enum; back up the database before running it in production.

Admins can delete users and teams that have no history (`DELETE /users/:id`, `DELETE /teams/:id`). A user with sheets,
approvals, chain membership or audit entries returns 409 `USER_HAS_HISTORY`: deactivate them instead. A team with members or
sheets returns 409 `TEAM_IN_USE`.

## Test
```
pnpm test                     # needs Docker (Testcontainers)
```

## Build
`pnpm build` emits to `dist/` (entry `dist/main.js`). `pnpm db:migrate:prod` and `pnpm seed` run from the build output.

## Production
```
POSTGRES_PASSWORD=… JWT_SECRET=… WEB_URL=https://overtrack.example.com SMTP_URL=smtp://… \
  docker compose -f docker-compose.prod.yml up -d --build
```
The `web` service builds from `../over-track-web` (a separate repo) and proxies `/api` to `api:3000`.
The API image applies migrations on start, then launches the server.
Deploy order for releases that change the schema: stop the old API, run migrations (the image does this on start), start the new one. Running an old build against a migrated database fails.

### Reverse proxy and `TRUST_PROXY`
The API rate-limits auth routes per client IP. Behind the `web` nginx every request arrives from the proxy, so the API must trust one hop and read the client address from `X-Forwarded-For`. `docker-compose.prod.yml` sets `TRUST_PROXY=1` for `api`; the web nginx must send `X-Forwarded-For` (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). Accepted values: `true`, `false` (default, direct exposure) or a hop count such as `1`. Do not set it when the API is reachable directly, or clients could spoof their IP.

## Google sign-in
Optional. When `GOOGLE_CLIENT_ID` is set, `POST /api/v1/auth/google` accepts a Google Identity Services credential (ID token), matches its email to an existing active user and issues the normal session. Unknown addresses get `403 GOOGLE_ACCOUNT_UNKNOWN`: there is no self sign-up. Without the variable the endpoint answers `503 GOOGLE_SIGNIN_DISABLED` and the web app shows only the password form.

Setup:
1. Google Cloud console → APIs & Services → Credentials → Create credentials → OAuth client ID, type **Web application**.
2. Authorized JavaScript origins: every web app origin, e.g. `http://localhost:5173` for development and `https://overtrack.example.com` for production. No redirect URIs are needed for the button flow.
3. OAuth consent screen: **Internal** restricts the button to accounts in your Google Workspace (users on other domains then use the invite + password path). **External** (published) lets any Google account use the button; the API still rejects addresses that are not users.
4. Put the client ID in `GOOGLE_CLIENT_ID` (API) and `VITE_GOOGLE_CLIENT_ID` (web build). The client secret is not used anywhere; do not store it.

## First deploy
1. Pick a `POSTGRES_PASSWORD` that is URL-safe (alphanumeric only): it is embedded in `DATABASE_URL`.
2. Start the stack (migrations are applied on start; default overtime types and settings are created on first boot):
   ```
   POSTGRES_PASSWORD=… JWT_SECRET=… WEB_URL=https://overtrack.example.com SMTP_URL=smtp://… \
     docker compose -f docker-compose.prod.yml up -d --build
   ```
3. Create the first admin (idempotent; password at least 10 characters):
   ```
   docker compose -f docker-compose.prod.yml run --rm \
     -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD=… -e ADMIN_FIRST_NAME=Ada -e ADMIN_LAST_NAME=Admin \
     api node dist/database/create-admin.js
   ```
   It prints `admin created: <email>` or `admin exists: <email>`.

`pnpm seed` loads demo data and refuses to run when `NODE_ENV=production`. Locally, `pnpm create-admin` does the same as step 3 using the `ADMIN_*` variables from the environment.

### Internal rollout from an HR export
When every employee already has a Google account (see "Google sign-in"), skip `create-admin` and the demo seed and load everyone from the HR spreadsheet instead:
```
docker compose down -v && docker compose up -d      # fresh local database; in production use the stack above
pnpm db:migrate
pnpm import-employees ~/Downloads/employees.xlsx --admin you@example.com [--dry-run]
```
The first sheet must have the header columns `EmployeeNumber`, `FullName`, `WorkEmail` and `Department` (other columns are ignored, order does not matter). Each row becomes a user with the Employee role, no team, no password and no invite email; the `--admin` address gets the Admin role. Names split at the first space into first and last name.

The script validates every row first (emails, duplicate emails and codes, two-word names, code and department lengths, codes already owned by other users). If anything is wrong it prints every problem with its row number and writes nothing. Re-running skips emails that already exist and never modifies them. It never deletes or deactivates anyone.

Afterwards, in the admin UI: create teams, pick each team's tech lead, assign the delivery manager, CTO and finance roles, and build approval chains. `pnpm create-admin` remains the break-glass way to get a password-holding admin on any environment.
