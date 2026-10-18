# OverTrack — Overtime Management System: Design Spec

Date: 2026-10-18
Status: Approved design, pending implementation plans
Repos: `over-track-api` (NestJS) and `over-track-web` (Vue). This spec lives in the API repo and is the single source of truth for both.

## 1. Purpose and scope

OverTrack replaces spreadsheets and email threads for overtime at a single company. Employees record overtime entries into a monthly sheet, submit it through a per-team approval chain, and finance marks approved sheets as paid. Managers and finance get a consolidated team view and XLSX/CSV exports.

Success criteria:
- An employee can record and submit a month of overtime in under five minutes.
- Every approver sees exactly the sheets waiting on them and nothing else.
- Finance can export one clean file per period with hours, weighted hours and payment status.
- Every state change is attributable to a person and visible on a timeline.

Out of scope for v1: multi-tenancy, SSO, payroll integration, salary or money calculation, mobile apps, bulk approve, leave or attendance tracking.

Decisions made during brainstorming:
- Hours plus admin-configured multipliers per overtime type. No money stored.
- Separate approval chain per team, configured by admin.
- Email + password auth; admin creates accounts.
- Rejection returns the sheet to the employee and restarts the chain on resubmit.
- Modular NestJS monolith, no Redis, no BullMQ. Event-emitter seam for later queueing.
- No admin-maintained public holiday list; the employee picks the overtime type.
- A consolidated team month sheet view and export exist alongside the per-employee sheet.

## 2. Roles

One role per user, fixed enum: `employee`, `tech_lead`, `delivery_manager`, `cto`, `finance`, `admin`.

| Capability | employee | tech_lead / delivery_manager / cto | finance | admin |
|---|---|---|---|---|
| Own sheets and entries | yes | yes | yes | yes |
| Act on an approval step | only if named on a chain | only if named on a chain | only if named on a chain | yes, as override with reason |
| Team month sheet | no | teams whose chain names them | all teams | all teams |
| Exports | no | their teams | all | all |
| Mark paid / revert paid | no | no | yes | yes |
| Manage users, teams, chains, overtime types | no | no | no | yes |
| Audit log viewer | no | no | own actions | all |

The three manager roles are labels only. Any active user can be placed on a chain regardless of role. Approver visibility derives from chain membership, not from role.

## 3. Domain model

### 3.1 User
`id, employeeCode (unique, optional), firstName, lastName, email (unique), passwordHash, role, teamId (nullable), timezone (IANA, default from settings), isActive, createdAt, updatedAt`.
Users are deactivated, never deleted. A deactivated user cannot log in; their sheets and decisions remain. A deactivated user who is a chain approver blocks that step; the admin team list warns about it.

### 3.2 Team
`id, name (unique), description, techLeadId (user, nullable), isActive, createdAt, updatedAt`.
A user belongs to at most one team. Admin, finance and CTO may have no team.

### 3.3 ApprovalChainStep
`id, teamId, position (1-based, unique per team), label (text, e.g. "Tech Lead"), approverId (user), backupApproverId (user, nullable), createdAt, updatedAt`.
A team with zero steps cannot have sheets submitted (`CHAIN_EMPTY`).

### 3.4 OvertimeType
`id, name (unique), multiplier (numeric(4,2), > 0), color (hex), sortOrder, isActive, createdAt, updatedAt`.
Seeded defaults: Weekday extra hours 1.50, Weekend 2.00, Public holiday 2.50, On-call / standby 1.00.
Changing a multiplier affects future entries only. Entries snapshot the multiplier at creation and again at submission (see 4.1).

### 3.5 Sheet
`id, employeeId, period (date, first day of month, unique with employeeId), status, round (int, starts at 1), currentStepPosition (nullable), totalHours, totalWeightedHours, submittedAt, approvedAt, rejectedAt, rejectionReason, paidAt, paidById, paymentReference, version (int, optimistic lock), createdAt, updatedAt`.
Created lazily when the employee adds the first entry for a month. Totals are recomputed on every entry change and stored.

### 3.6 SheetEntry
`id, sheetId, date, startTime, endTime, hours (numeric(4,2), 0.25 steps, 0.25..16), overtimeTypeId, multiplierSnapshot, weightedHours, workItem (text, max 120), workItemUrl (nullable, must be http(s)), description (text, 10..1000 chars), requestedById (user, nullable), attachmentId (nullable), createdAt, updatedAt`.

Validation:
- `date` must fall inside the sheet's period and must not be after today (in the employee's timezone).
- `startTime < endTime`, both on the same date. `hours` defaults to the difference rounded to 0.25 but is editable.
- No two entries on the same sheet may overlap in time on the same date (`ENTRY_OVERLAP`).
- Entries are editable only while the sheet is `draft` or `rejected` (`SHEET_NOT_EDITABLE`).

### 3.7 SheetApprovalStep (chain snapshot)
`id, sheetId, round, position, label, approverId, backupApproverId, status (pending | approved | rejected | skipped), decidedById (nullable), decidedAt, comment, overrideReason (nullable, set when admin acts), createdAt`.
Written at submit time by copying the team's ApprovalChainSteps. One set per round.

### 3.8 Attachment
`id, ownerId, storageKey, originalName, mimeType, sizeBytes, createdAt`. One per entry, optional. Allowed MIME: image/png, image/jpeg, application/pdf. Max 5 MB. Stored on local disk under `STORAGE_PATH` behind a `StorageService` interface so S3 can replace it later.

### 3.9 AuditLog
`id, actorId (nullable for system), action (text enum), entityType, entityId, before (jsonb), after (jsonb), reason (nullable), createdAt`. Append-only. Written for every sheet transition and every admin config change.

### 3.10 Notification
`id, userId, type, title, body, link, readAt, createdAt`.

### 3.11 RefreshToken, PasswordToken
Refresh: `id, userId, tokenHash, expiresAt, revokedAt, replacedById`. Password: `id, userId, tokenHash, purpose (invite | reset), expiresAt, usedAt`.

### 3.12 Settings (single row)
`defaultTimezone, companyName, reminderDayOfMonth (default 1)`.

## 4. Workflow

### 4.1 States and transitions

```
draft ──submit──▶ submitted ──approve(last step)──▶ approved ──markPaid──▶ paid
  ▲                  │  │                               │  ▲                 │
  │                  │  └──reject──▶ rejected ──resubmit─┘  └──revertPaid────┘
  │                  │                  │
  └────withdraw──────┘                  └──(edit entries while rejected)
  ▲
  └────reopen (admin, from approved)
```

| Action | Who | From | To | Rules |
|---|---|---|---|---|
| submit | employee (owner) | draft, rejected | submitted | ≥1 entry; team has ≥1 chain step; snapshot chain as round N; steps whose approver == employee are marked `skipped` with comment "self"; if all steps are skipped the sheet goes straight to approved; otherwise currentStepPosition = first pending. Resubmit from rejected increments round. Re-snapshots entry multipliers from current overtime types. |
| withdraw | employee (owner) | submitted | draft | Only if no step in the current round is approved. Pending steps of the round are deleted. |
| approve | current step approver, its backup, or admin | submitted | submitted or approved | Marks step approved with optional comment; advances to next pending step; if none, sheet → approved. Admin must supply overrideReason. |
| reject | current step approver, its backup, or admin | submitted | rejected | Reason required (≥ 5 chars). Remaining pending steps of the round are marked skipped with comment "round rejected". |
| reopen | admin | approved | draft | Reason required. Round is kept; resubmit creates round+1. |
| markPaid | finance, admin | approved | paid | paymentReference required (text, ≤ 60), paidAt defaults to now. Supports bulk: one reference for many sheet ids. |
| revertPaid | finance, admin | paid | approved | Reason required. Clears paid fields. |

Every transition:
1. Runs inside one transaction with `SELECT ... FOR UPDATE` on the sheet row.
2. Checks `version` matches the client's `If-Match` / body `version`; mismatch → `409 SHEET_VERSION_CONFLICT`.
3. Delegates the decision to a pure function `transition(sheet, steps, actor, action, payload) → { nextSheet, nextSteps, events } | DomainError`. This function has no I/O and is unit tested exhaustively.
4. Persists, writes an AuditLog row, increments `version`, emits domain events after commit.

### 4.2 Approver inbox scopes
- `waiting`: sheets in `submitted` whose current step names the caller as approver or backup.
- `upcoming`: sheets in `submitted` with a later pending step naming the caller.
- `decided`: steps the caller decided, newest first.
Admin sees all `submitted` sheets under `waiting`.

### 4.3 Team month sheet
Query: `teamId, period`, optional `status[]`. Returns one row per active team member (plus any member with a sheet that month who has since moved): employee, sheet status, payment status, hours per overtime type, total hours, total weighted hours, submittedAt, paidAt. Rows expand to entries. Visibility: admin and finance see all teams; other callers see teams whose current chain names them (as approver or backup) or where they are tech lead.

## 5. Backend architecture (`over-track-api`)

### 5.1 Stack
NestJS 11 on `@nestjs/platform-fastify`, Postgres 16, Drizzle ORM + drizzle-kit migrations, `nestjs-zod` for DTOs (one Zod schema → validation + type + OpenAPI), `@nestjs/swagger` serving `/docs` when `NODE_ENV !== production`, `@nestjs/event-emitter`, `@nestjs/schedule` for the monthly reminder, `nodemailer`, `exceljs`, `argon2`, `@fastify/multipart`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/cookie`. Tooling: pnpm, TypeScript strict, ESLint, Prettier, Vitest, Testcontainers.

### 5.2 Modules
```
src/
  main.ts, app.module.ts
  common/        config (zod-validated env), guards (JwtAuthGuard, RolesGuard), decorators (@CurrentUser, @Roles),
                 filters (HttpExceptionFilter → problem shape), errors (DomainError + codes), pagination helpers
  database/      drizzle client, schema/*.ts (one file per table), migrations/, seed.ts
  auth/          login, refresh, logout, accept-invite, forgot, reset; JWT strategy; token services
  users/         CRUD, invite (creates PasswordToken + email), deactivate, me
  teams/         CRUD, members, tech lead
  approval-chains/  get/replace steps for a team (full-list replace in one transaction, validates positions and active approvers)
  overtime-types/   CRUD
  sheets/        sheet lookup/create-for-period, entry CRUD, totals recompute, attachments (StorageService)
  workflow/      transition.ts (pure), workflow.service.ts (tx + lock + audit + events), controller for the action endpoints, inbox query
  reports/       team-month query, exports (xlsx/csv builders)
  notifications/ event listeners → in-app rows + MailService; templates; reminder cron
  audit/         writer + per-sheet timeline query + admin list
  health/        GET /health (db ping)
```
Each module exposes one service used by others; modules never reach into another module's tables directly.

### 5.3 Auth
- Login returns `{ accessToken }` (JWT, 15 min, payload `sub, role, teamId`) and sets an httpOnly, Secure, SameSite=Lax cookie `ot_refresh` (7 days). Refresh rotates: old token revoked, new issued; reuse of a revoked token revokes the whole family.
- Admin creates a user → invite email with a 24 h link `${WEB_URL}/accept-invite?token=…`. Forgot password → 1 h link. Tokens stored hashed.
- Rate limit: 10 requests/min per IP on `/auth/*`.
- Password policy: ≥ 10 chars.

### 5.4 API
Prefix `/api/v1`. JSON. List endpoints accept `page` (1-based), `pageSize` (≤ 100), `sort` (`field:asc|desc`) and return `{ data: T[], meta: { page, pageSize, total } }`. Single resources return `{ data: T }`. Errors return `{ statusCode, code, message, details? }`.

```
POST /auth/login  POST /auth/refresh  POST /auth/logout
POST /auth/accept-invite  POST /auth/forgot-password  POST /auth/reset-password
GET  /me   PATCH /me (name, timezone)   POST /me/change-password
GET  /me/notifications?unreadOnly   POST /me/notifications/:id/read   POST /me/notifications/read-all

GET/POST /users   GET/PATCH /users/:id   POST /users/:id/deactivate   POST /users/:id/reactivate   POST /users/:id/resend-invite
GET/POST /teams   GET/PATCH /teams/:id   GET /teams/:id/members
GET /teams/:id/chain   PUT /teams/:id/chain        (body: ordered steps; replaces all)
GET/POST /overtime-types   PATCH /overtime-types/:id

GET  /sheets?employeeId&period&status&page   (employee: own only; others per visibility rules)
GET  /sheets/:id          GET /sheets/:id/timeline
POST /sheets/for-period   (body: period → returns existing or creates draft for caller)
POST /sheets/:id/entries   PATCH /sheets/:id/entries/:entryId   DELETE /sheets/:id/entries/:entryId
POST /sheets/:id/entries/:entryId/attachment (multipart)   DELETE …/attachment   GET /attachments/:id (authenticated stream)
POST /sheets/:id/submit | withdraw | approve | reject | reopen | mark-paid | revert-paid   (body includes version, comment/reason/paymentReference as applicable)
POST /sheets/mark-paid   (body: sheetIds[], paymentReference) — bulk

GET  /approvals/inbox?scope=waiting|upcoming|decided&page
GET  /reports/team-month?teamId&period&status
GET  /reports/team-month/export?teamId&period&status&format=xlsx|csv
GET  /reports/employees/export?period&teamId&status&format=xlsx|csv
GET  /admin/audit?entityType&entityId&actorId&from&to&page
GET  /health
```

Domain error codes: `INVALID_CREDENTIALS, TOKEN_EXPIRED, TOKEN_REUSED, USER_INACTIVE, FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, SHEET_NOT_EDITABLE, SHEET_VERSION_CONFLICT, SHEET_EMPTY, CHAIN_EMPTY, CHAIN_APPROVER_INACTIVE, NOT_CURRENT_APPROVER, INVALID_TRANSITION, ENTRY_OVERLAP, ENTRY_OUT_OF_PERIOD, ENTRY_IN_FUTURE, ATTACHMENT_TOO_LARGE, ATTACHMENT_TYPE, REASON_REQUIRED, PAYMENT_REFERENCE_REQUIRED`.

### 5.5 Domain events and notifications
Events (emitted after commit): `sheet.submitted, sheet.step_approved, sheet.approved, sheet.rejected, sheet.withdrawn, sheet.reopened, sheet.paid, sheet.payment_reverted, user.invited, user.password_reset_requested`.

| Event | In-app to | Email to |
|---|---|---|
| submitted | current step approver (+ backup) | same |
| step_approved | employee, next approver (+ backup) | next approver |
| approved | employee, all finance users | employee |
| rejected | employee | employee |
| withdrawn / reopened | approvers of the round | none |
| paid | employee | employee |
| payment_reverted | employee | none |
| invited / password_reset_requested | none | the user |
| monthly reminder (cron, `reminderDayOfMonth` 08:00 default tz) | employees with a non-empty draft for the previous month | same |

Email: nodemailer SMTP from env; MailHog in dev. Plain HTML templates with a single CTA link. Failures are logged, never bubble into the request.

### 5.6 Exports
Built with exceljs, streamed with `Content-Disposition: attachment`. File name `overtrack-<team|all>-<YYYY-MM>.xlsx`.
- Sheet "Summary": Employee code, Employee, Team, one column per active overtime type (hours), Total hours, Weighted hours, Status, Submitted at, Approved at, Paid at, Payment reference.
- Sheet "Details": Employee code, Employee, Team, Date, Start, End, Hours, Type, Multiplier, Weighted hours, Work item, Work item URL, Description, Requested by, Sheet status.
CSV returns the Details layout only. Exports apply the caller's team visibility.

### 5.7 Testing
- Unit: `transition()` covers every (state, action, actor) cell including self-skip, all-skipped, backup approver, admin override, withdraw after first approval (rejected), version conflict.
- Integration (Testcontainers Postgres): services for sheets, workflow, reports, auth token rotation.
- E2E (Fastify inject against seeded DB): login → add entries → submit → approve twice → mark paid → export contains the row.
- `pnpm seed` creates: admin, finance, CTO, two teams each with a tech lead, delivery manager and three employees, chains TL → DM → CTO, overtime types, and sheets in every state for last month.

### 5.8 Local dev and deployment
`docker-compose.yml`: postgres:16, mailhog. `.env.example` documents `DATABASE_URL, JWT_SECRET, JWT_ACCESS_TTL, REFRESH_TTL_DAYS, WEB_URL, SMTP_URL, MAIL_FROM, STORAGE_PATH, CORS_ORIGIN, PORT`. Dockerfile (multi-stage, runs migrations then starts). `docker-compose.prod.yml` runs api + postgres + web (nginx) on one host.

## 6. Frontend architecture (`over-track-web`)

### 6.1 Stack
Vue 3.5 (`<script setup lang="ts">`), Vite, Vue Router, Pinia (client state: auth, ui, notifications), TanStack Query (server state), Tailwind v4, Reka UI (headless primitives), lucide-vue-next, VeeValidate + Zod, TanStack Table, date-fns + date-fns-tz, openapi-typescript (types generated from `GET /docs-json`), Vitest + Vue Test Utils, Playwright.

### 6.2 Structure
```
src/
  app/          router.ts (lazy routes, role meta, guards), providers.ts (query client, toast), App.vue
  api/          client.ts (fetch wrapper: base URL, bearer, refresh-on-401 with single-flight, error mapping), schema.d.ts (generated), <feature>.api.ts
  components/ui/   Button, Input, Textarea, Select, Combobox, DatePicker, TimeInput, Checkbox, Switch, FormField,
                   Badge, StatusBadge, Card, StatTile, Dialog, Drawer, DropdownMenu, Tabs, DataTable, Pagination,
                   Toast, Skeleton, EmptyState, Timeline, Avatar, PageHeader
  components/layout/  AppShell, Sidebar, Topbar, NotificationsMenu, UserMenu
  features/
    auth/        LoginPage, AcceptInvitePage, ForgotPasswordPage, ResetPasswordPage
    dashboard/   DashboardPage (role-aware tiles)
    sheets/      MySheetsPage, SheetPage, components/{EntryForm, EntriesTable, SheetTotals, SheetActions, RejectionBanner}
    approvals/   InboxPage, ReviewSheetPage, components/{DecisionDialog, ApprovalTimeline}
    reports/     TeamMonthPage, components/{TeamMonthTable, ExportButton}
    payments/    PaymentsPage, components/{MarkPaidDialog}
    admin/       UsersPage, UserFormDrawer, TeamsPage, TeamFormDrawer, ChainEditorPage, OvertimeTypesPage, AuditLogPage
    profile/     ProfilePage
  stores/       auth.store.ts, ui.store.ts (sidebar, theme), notifications.store.ts
  lib/          dates.ts, format.ts (hours, tabular), errors.ts (code → message), permissions.ts
  styles/       tokens.css (light/dark semantic tokens), base.css
```

### 6.3 Design system
Style: data-dense dashboard. Light and dark themes via semantic CSS variables consumed by Tailwind; `prefers-color-scheme` default with a manual toggle persisted in `localStorage`.

| Token | Light | Dark |
|---|---|---|
| `--color-primary` | `#1E3A5F` | `#93B4E0` |
| `--color-on-primary` | `#FFFFFF` | `#0B1A2E` |
| `--color-secondary` | `#2563EB` | `#60A5FA` |
| `--color-accent` | `#059669` | `#34D399` |
| `--color-destructive` | `#DC2626` | `#F87171` |
| `--color-background` | `#F8FAFC` | `#0F172A` |
| `--color-surface` | `#FFFFFF` | `#1E293B` |
| `--color-foreground` | `#0F172A` | `#E2E8F0` |
| `--color-muted` | `#F1F3F5` | `#273449` |
| `--color-muted-foreground` | `#475569` | `#94A3B8` |
| `--color-border` | `#E4E7EB` | `#334155` |
| `--color-ring` | `#1E3A5F` | `#93B4E0` |

Typography: Fira Sans 400/500/600 for UI, Fira Code 400/500 for hours, periods, employee codes and payment references, `font-variant-numeric: tabular-nums` on all numeric cells. Base 16px, scale 12/14/16/18/24/32, line-height 1.5.
Spacing: 4px base, 8px rhythm. Radius 6px controls, 10px cards. Shadows: one `sm` for cards, one `lg` for dialogs. Transitions 150–250ms ease-out, exits shorter, `prefers-reduced-motion` disables them.
Status badges (always icon + label + color): draft `muted` + pencil, submitted `secondary` + clock, approved indigo `#4F46E5` + check, paid `accent` + check-circle, rejected `destructive` + x-circle.
Icons: Lucide only, 20px, stroke 1.75. No emoji icons.
Contrast ≥ 4.5:1 verified for every foreground/background pair in both themes.

### 6.4 Layout and navigation
- ≥ 1024px: fixed left sidebar (collapsible to icons), content max-width 1400px. < 1024px: top bar with menu button opening a drawer. Nav items show icon + label and highlight the active route.
- Sidebar items by role: Dashboard, My sheets (all); Inbox (any chain member or admin, with waiting-count badge); Team month (manager roles, finance, admin); Payments (finance, admin); Admin group: Users, Teams, Overtime types, Audit (admin).
- Every screen is deep-linkable. Filters live in the query string.
- Tables wrap in `overflow-x-auto` cards; above 50 rows the table paginates server-side.

### 6.5 Screens
- Login / Accept invite / Forgot / Reset: single card, visible labels, inline validation on blur, password show/hide.
- Dashboard: stat tiles by role (employee: this month hours, weighted, status; approver: waiting count; finance: approved-unpaid count and hours) plus a "recent activity" list from notifications.
- My sheets: month list, newest first, status badge, totals, click → Sheet page. Button "Add entry for this month" opens the current month.
- Sheet page: header with period, status badge, totals; entries table (date, time range, hours, type chip, weighted, work item, description truncated with tooltip, attachment icon, row actions); right-side Drawer EntryForm (date picker limited to period and ≤ today, start/end TimeInput, hours auto-filled, type Select showing multiplier, work item + URL, description, requested-by Combobox, attachment upload); sticky footer with Submit (confirm dialog listing the chain steps) or Withdraw; RejectionBanner with reason and "Fix and resubmit"; ApprovalTimeline per round.
- Inbox: Tabs Waiting / Upcoming / Decided; rows show employee, team, period, hours, step label, submitted date, age. Review page = Sheet page read-only + DecisionDialog (approve with comment, reject with required reason).
- Team month: team Select, month picker, status filter; table one row per employee with per-type hour columns, total, weighted, status and paid badges; expand row → entries; ExportButton (xlsx/csv).
- Payments: Tabs Approved (unpaid) / Paid; checkbox column + action bar "Mark paid (n)" → MarkPaidDialog (payment reference, date); Paid tab rows offer "Revert" with reason.
- Admin Users: table with search, role filter, active filter; drawer form; actions invite/resend/deactivate. Teams: table, drawer form, "Chain" link. Chain editor: ordered list with drag handle, label, approver and backup Combobox, add/remove, warning banner if empty or an approver is inactive, Save replaces the chain. Overtime types: table with inline multiplier edit and active toggle. Audit log: filterable table with before/after JSON diff in an expandable row.
- Profile: name, timezone, theme, change password.
- Notifications menu: unread list, mark all read, each item links to the sheet.

### 6.6 Cross-cutting UX rules
- Every async button shows a spinner and disables while pending. Every list has skeleton, empty and error states with retry.
- Destructive or irreversible actions (delete entry, submit, reject, mark paid, revert, reopen, deactivate) confirm in a Dialog.
- Toasts auto-dismiss in 4 s, `aria-live="polite"`, never steal focus.
- Form errors appear under the field; after a failed submit focus moves to the first invalid field. Server `VALIDATION_FAILED` details map onto fields; other error codes map to messages in `lib/errors.ts`.
- Unsaved EntryForm changes prompt before the drawer closes.
- Keyboard: all Reka primitives are keyboard-accessible; visible focus rings; skip-to-content link.

### 6.7 Testing
- Vitest: ui components (StatusBadge variants, DataTable sorting, EntryForm validation), `lib/*`, auth store refresh logic.
- Playwright against the seeded API: employee submit flow, approver approve and reject flow, finance mark-paid and export download.

## 7. Security
- JWT guard on every route except `/auth/*` and `/health`. Roles guard for admin and finance routes. Ownership and chain-membership checks live in services, not controllers.
- Attachments served only through `GET /attachments/:id` after an ownership or visibility check. MIME sniffed server-side; size limit enforced by `@fastify/multipart`.
- Helmet, CORS limited to `CORS_ORIGIN`, rate limiting on auth, cookies `Secure` in production.
- No secrets in code. Audit log for every transition and admin config change.

## 8. Build order
Each phase ends in a usable increment. API and web phases 1–2 can run in parallel.
1. API foundation: scaffold, config, Drizzle schema + migrations, auth, users, teams, seed, Swagger, health, Docker compose.
2. Web foundation: scaffold, tokens, ui components, app shell, auth pages and store, generated API client, dashboard skeleton.
3. Sheets: overtime types, sheet and entry CRUD, attachments, My sheets, Sheet page with EntryForm.
4. Workflow: chain config + editor, `transition()`, action endpoints, inbox, timeline, notifications and emails.
5. Finance and reports: mark paid / revert, Payments page, team month query and page, xlsx/csv exports.
6. Polish and ship: audit log viewer, monthly reminder, dark mode pass, Playwright flows, Dockerfiles and prod compose.

## 9. Open assumptions
- Company size is tens to low hundreds of users; synchronous export and email are adequate.
- One timezone per user; period boundaries use the employee's timezone.
- Overtime type multipliers are company-wide, not per team.
