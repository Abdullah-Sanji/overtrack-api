# OverTrack follow-ups: roles, deletes, form reset, confirm dialogs, visual refresh

**Date:** 2026-10-19
**Status:** approved in conversation, pending written review
**Parent spec:** `2026-10-18-overtrack-design.md` (this document amends it; where they disagree, this one wins)
**Repos:** `over-track-api` (NestJS, Fastify, Drizzle, PostgreSQL), `over-track-web` (Vue 3, Pinia, TanStack Query, Tailwind v4, Reka UI)

## 1. Goals

1. Admins can create, rename and delete roles. A role is a named label with one of four permission levels. Permissions do not change.
2. Admins can hard-delete users and teams that have no history. Anything with history stays and is deactivated instead.
3. The overtime entry form clears after a successful add and whenever the drawer closes, so derived hours are always recomputed.
4. No browser `confirm()`, `alert()` or `prompt()` anywhere in the web app. Every confirmation uses the app's dialog.
5. The Dashboard menu item is highlighted only on the dashboard.
6. A visual refresh: indigo and emerald palette, Plus Jakarta Sans, a dark sidebar with a logo mark, colour where it carries meaning. Dark mode is kept.

Out of scope: a permission matrix per role, soft delete with a `deleted_at` column, multiple roles per user, changing any approval or payment behaviour.

## 2. API

### 2.1 Roles

**Schema.** New table `roles`:

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text, unique on `lower(name)` | 2 to 40 chars, trimmed |
| level | enum `role_level` (`employee`, `manager`, `finance`, `admin`) | drives permissions |
| is_system | boolean, default false | seeded roles; cannot be deleted |
| created_at, updated_at | timestamptz | |

`users.role_id uuid not null references roles(id)` replaces `users.role`. The `user_role` enum is dropped.

**Migration 0002**, one transaction:
1. create `role_level` enum and `roles` table;
2. insert the six system roles: Employee (employee), Tech Lead (manager), Delivery Manager (manager), CTO (manager), Finance (finance), Admin (admin), all `is_system = true`;
3. add `users.role_id` nullable, backfill by mapping the old enum value to the matching role (`employee → Employee`, `tech_lead → Tech Lead`, `delivery_manager → Delivery Manager`, `cto → CTO`, `finance → Finance`, `admin → Admin`);
4. set `role_id` not null, drop `users.role`, drop the `user_role` enum.

Bootstrap (`BootstrapService`) ensures the six system roles exist on every start, by name, idempotently, so a fresh database without seed data still has them.

**Auth context.** `AuthUser` becomes `{ id, roleId, level, teamId }`. The JWT payload carries `level` and `roleId`; the guard still loads the user row for `isActive`, so a level change takes effect at the next access-token refresh at the latest (15 minutes).

**Guards.** `@Roles(...)` is renamed `@Levels(...)` and takes `RoleLevel` values. Mapping of existing checks:

| today | after |
|---|---|
| `@Roles('admin')` | `@Levels('admin')` |
| `@Roles('finance', 'admin')` | `@Levels('finance', 'admin')` |
| `@Roles(...MANAGER_ROLES)` | `@Levels('manager', 'finance', 'admin')` |
| `user.role === 'admin'` in services | `user.level === 'admin'` |
| `MANAGER_ROLES.includes(user.role)` in visibility and inbox | `MANAGER_LEVELS.includes(user.level)` where `MANAGER_LEVELS = ['manager', 'finance', 'admin']` |

Chain membership remains the only source of approver rights. Nothing else about visibility changes.

**Public user shape.** `role: UserRole` becomes `role: { id: string; name: string; level: RoleLevel }` on every user payload (`/me`, users list, directory, sheet employee summaries, timeline actors). The directory keeps omitting emails.

**Endpoints** (`/api/v1/roles`):

| method | path | who | body / result |
|---|---|---|---|
| GET | `/roles` | any signed-in user | `data: RoleView[]` sorted by name; `RoleView = { id, name, level, isSystem, userCount }` |
| POST | `/roles` | admin | `{ name, level }` → 201 `RoleView` |
| PATCH | `/roles/:id` | admin | `{ name?, level? }` → `RoleView` |
| DELETE | `/roles/:id` | admin | 204 |

Rules and error codes:
- name uniqueness is case-insensitive → 409 `ROLE_NAME_TAKEN`;
- a system role may be renamed, but its level cannot be changed and it cannot be deleted → 409 `ROLE_IS_SYSTEM` (this guarantees an admin-level role always exists);
- a role with `userCount > 0` cannot be deleted → 409 `ROLE_IN_USE`;
- an admin cannot change the level of their own custom role away from `admin` → 409 `CANNOT_DEMOTE_SELF`.

Audit: `role.created`, `role.updated` (with before and after), `role.deleted`.

**Users.** `POST /users` and `PATCH /users/:id` take `roleId` instead of `role`. Unknown id → 404 `NOT_FOUND`. Seed and `create-admin` look up roles by name.

### 2.2 Deleting users

`DELETE /users/:id`, admin only, 204.

Allowed only when all of these hold; otherwise 409 `USER_HAS_HISTORY` with message "This user has history (sheets, approvals or audit entries). Deactivate them instead.":
- no row in `sheets.employee_id`, `sheets.paid_by_id`, `sheet_entries.requested_by_id`, `attachments.owner_id`;
- no row in `sheet_approval_steps` as `approver_id`, `backup_approver_id` or `decided_by_id`;
- no row in `audit_log.actor_id`;
- no row in `approval_chain_steps` as `approver_id` or `backup_approver_id`;
- not `teams.tech_lead_id` of any team.

The actor cannot delete themselves → 409 `CANNOT_DELETE_SELF`. The check and the delete run in one transaction. Rows that cascade today (`notifications`, `refresh_tokens`, `password_tokens`) keep cascading. Audit `user.deleted` with the deleted email and name in the payload, actor = the admin.

### 2.3 Deleting teams

`DELETE /teams/:id`, admin only, 204.

Allowed only when `users.team_id` has no row for the team and `sheets.team_id` has no row for the team; otherwise 409 `TEAM_IN_USE` with message "This team still has members or sheets. Move the members first, or deactivate the team." `approval_chain_steps` cascade (already declared). Audit `team.deleted`.

### 2.4 Tests

- Migration 0002 runs on the Testcontainers database from a 0001 state with one user per old role and leaves the expected `role_id` on each.
- Guard: `@Levels` allows and denies by level; a user whose role level changed is denied after re-login.
- Roles: CRUD happy paths and each 409 case above; list includes `userCount`.
- Users: delete succeeds for a fresh invitee; each blocking condition returns 409; self-delete returns 409.
- Teams: delete succeeds for an empty team with a chain (steps gone); member and sheet cases return 409.
- Existing suites updated for the role shape; count stays at or above 132.

## 3. Web

### 3.1 Entry form

- After a successful **add**: toast, `emit('saved')`, then `resetForm({ values: emptyValues() })` and `lastDerived = null`. The drawer stays open. Focus moves to the date field.
- After a successful **edit**: toast, `emit('saved')`, and the parent closes the drawer.
- When `open` turns false (any close path): `resetForm({ values: emptyValues() })`, `lastDerived = null`, `formError = ''`. The existing watch on `open` turning true keeps populating edit values.
- Test: add → form fields empty and hours undefined; set start and end → hours derived; close while dirty and reopen → empty.

### 3.2 Confirm dialogs

- `useConfirm()` in `src/composables/useConfirm.ts` exposes `confirm(opts): Promise<boolean>` with `opts = { title, description?, confirmLabel?, cancelLabel?, tone?: 'default' | 'destructive' }`. State lives in a tiny Pinia store so one `<ConfirmHost />`, mounted once in `AppShell`, renders the existing `ConfirmDialog`. Resolving happens on confirm, cancel, escape or overlay close.
- Replacements, all with title "Discard unsaved changes?", description "Your changes will be lost.", confirm "Discard" (destructive), cancel "Keep editing":
  - `EntryForm.vue` drawer close;
  - `UserFormDrawer.vue` close and Cancel;
  - `TeamFormDrawer.vue` close and Cancel;
  - `ChainEditorPage.vue` `onBeforeRouteLeave` (async guard returning the promise result).
- Drawer close guards become async: the drawer's `update:open` handler awaits the dialog and only then emits the close.
- ESLint: `no-restricted-globals` for `confirm`, `alert`, `prompt`, and `no-restricted-properties` for `window.confirm`, `window.alert`, `window.prompt`.
- Tests: `useConfirm` resolves true on confirm and false on cancel; one drawer test proving close is blocked until the dialog resolves.

### 3.3 Sidebar active state

Dashboard uses `isExactActive`; all other items keep `isActive`. Test: on `/sheets/123` the Dashboard item has no `aria-current` and My sheets does.

### 3.4 Roles page

- Route `/admin/roles`, name `admin-roles`, admin guard, Admin menu item "Roles" with the `Shield` icon between Teams and Overtime types.
- Table columns: Name, Level (badge), Users (count), System (badge when `isSystem`). Row menu: Edit, Delete (hidden for system roles, disabled with tooltip "In use" when `userCount > 0`).
- `RoleFormDrawer`: name input and level select (`Employee`, `Manager`, `Finance`, `Admin`) with helper text per level copied from the parent spec's capability table. Dirty check through `useConfirm`.
- Delete through `useConfirm` with `tone: 'destructive'`; a 409 shows the API message as a toast.
- `UserFormDrawer` role select loads `rolesApi.list()`; the users table shows `role.name`; the profile page shows the role name.
- Query keys: `['roles']`; invalidate on every mutation and on user create or update.
- Tests: page renders rows and hides Delete for system roles; drawer validation; API module shape.

### 3.5 Delete actions

- Users table row menu gains "Delete" (destructive) after "Deactivate". Confirm copy: "Delete {name}? This removes the account permanently. Users with sheets or approvals cannot be deleted and should be deactivated instead." On 409 `USER_HAS_HISTORY` the toast carries the API message and offers a "Deactivate instead" action that runs the existing deactivate flow.
- Teams table row menu gains "Delete". Confirm copy: "Delete {name}? Its approval chain is removed too. Teams with members or sheets cannot be deleted." On 409 the API message is toasted.
- Tests: menu shows Delete; confirming calls the API; a 409 shows the toast.

### 3.6 Visual refresh

**Tokens** (`src/styles/tokens.css`), light:

| token | value |
|---|---|
| primary / on-primary | `#4f46e5` / `#ffffff` |
| primary-soft (new) | `#eef2ff` |
| secondary / on-secondary | `#6366f1` / `#ffffff` |
| accent / on-accent | `#059669` / `#ffffff` |
| accent-soft (new) | `#ecfdf5` |
| warning / warning-soft (new) | `#d97706` / `#fffbeb` |
| destructive / destructive-soft (new) | `#dc2626` / `#fef2f2` |
| background | `#f5f3ff` |
| surface | `#ffffff` |
| foreground | `#1e1b4b` |
| muted / muted-foreground | `#eef0f7` / `#5b6478` |
| border | `#e0e7ff` |
| ring | `#4f46e5` |
| sidebar / sidebar-foreground / sidebar-muted / sidebar-active (new) | `#1e1b4b` / `#eef2ff` / `#a5b4fc` / `rgba(255,255,255,0.12)` |

Dark: primary `#a5b4fc` on `#1e1b4b`, accent `#34d399`, background `#0f0e1a`, surface `#1a1930`, foreground `#e0e7ff`, muted `#262541`, border `#312e5e`, sidebar `#14132a`, soft variants at 15 percent alpha of their hue. All text pairs meet 4.5:1; soft backgrounds are decorative only and always paired with text in the full hue.

Radii: `--radius-control: 8px`, `--radius-card: 12px`. Shadow token `--shadow-card: 0 1px 2px rgb(30 27 75 / 0.06), 0 4px 12px rgb(30 27 75 / 0.06)`; cards use it instead of a border in light mode and keep a border in dark mode.

**Type.** `index.html` loads Plus Jakarta Sans 400, 500, 600, 700 and Fira Code 400, 500 with `display=swap`. `--font-sans: 'Plus Jakarta Sans', ...`. Scale: page title 28px/700, section and card titles 18px/600, body 16px/400 line-height 1.5, labels 14px/500, captions 12px/500. The `num` utility stays Fira Code with `font-variant-numeric: tabular-nums` and is the only place Fira Code appears.

**Sidebar.** Background `sidebar`, text `sidebar-foreground`, group labels in `sidebar-muted`. Active item: `sidebar-active` background, white text, a 3px primary-light left bar. Hover: 8 percent white. Top: logo mark 32px plus "OverTrack" wordmark 18px/700; in collapsed mode the mark only. The mobile drawer uses the same surface.

**Logo.** `src/assets/logo.svg`: a 32×32 rounded square (radius 8) filled `#4f46e5`, containing a white clock ring (stroke 2.5, radius 10) with a short hour hand to 12 and a minute hand to 4, and a small emerald check circle overlapping the bottom-right corner. Also used as the favicon (`public/favicon.svg`) and on the login page above the form at 48px.

**Colour with meaning.**
- Stat tiles: icon in a soft tinted circle (primary-soft, accent-soft, warning-soft) with the icon in the full hue; value in `num`.
- Status badges: draft muted, submitted primary-soft/primary, approved accent-soft/accent, rejected destructive-soft/destructive, paid `#ecfdf5`/`#047857` with a check icon.
- Dashboard header: greeting on a primary-soft to surface gradient card.
- Buttons: primary indigo, secondary white with border, ghost, destructive red; 44px tall default, 36px small.
- Inputs: 44px, border `border`, focus ring 2px `ring` with 2px offset.
- Tables: header row `muted` background with 12px uppercase 500 labels, row hover `primary-soft` at 40 percent, zebra off.
- Login page: background gradient from `#eef2ff` to `#f5f3ff`, centred card, logo above.

**Motion.** 150ms colour transitions, 200ms drawer and dialog, `prefers-reduced-motion` disables transforms. No new animation beyond that.

**Checks.** Lint, type-check and build pass; every component still reads tokens only (no raw hex outside `tokens.css` and `logo.svg`); Playwright flows pass unchanged since selectors are role and text based; a manual contrast pass on the badge and sidebar pairs is recorded in the task report.

### 3.7 E2E

One new Playwright flow `04-admin-roles-and-deletes.spec.ts`: admin creates role "QA Lead" (manager), assigns it to an employee, delete of that role is refused with the in-use message, delete of the Platform team is refused, admin creates a throwaway user and deletes them successfully.

## 4. Build order

API first, then web, each as its own plan and branch:

1. API: roles schema, migration, bootstrap, auth context and guards, user shape, role endpoints, seed and create-admin, tests.
2. API: user and team delete endpoints with tests. Update README and Swagger.
3. Web: types and API modules for roles and deletes; permissions switch to `level`.
4. Web: `useConfirm` and the six replacements, lint rule, sidebar exact-active, entry form reset.
5. Web: roles page, user form role select, delete actions.
6. Web: tokens, fonts, logo, sidebar, badges and tiles, login page.
7. Web: new e2e flow; README updates.

## 5. Risks

- Dropping the `user_role` enum is one-way. The migration runs in a transaction and is tested from a 0001 state; take a database backup before running it in production.
- Access tokens carry `level`, so a level change applies within 15 minutes, not instantly. Acceptable for an internal tool and consistent with how deactivation is handled today.
- The token rename touches every component through Tailwind utility names (`bg-primary` and so on). Names are kept; only values change, plus new `-soft` and `sidebar-*` tokens, so the blast radius is the stylesheet and the components that opt into the new tokens.
