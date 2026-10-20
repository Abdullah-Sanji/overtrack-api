# OverTrack Web follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roles page, delete actions, app-native confirm dialogs, entry-form reset, the Dashboard active-state fix and the indigo/emerald visual refresh on top of the new role-level API.

**Architecture:** Types and permission checks move from role names to `role.level` first so the app compiles against the upgraded API. A promise-based confirm dialog replaces every browser prompt. New admin pages reuse the existing DataTable, Drawer and DropdownMenu kit. The visual refresh is token-driven: values and a handful of new tokens change in `tokens.css`, and only the sidebar, badges, tiles and auth card opt into new tokens.

**Tech Stack:** Vue 3.5, Vite 8, TypeScript strict, Pinia 3, TanStack Query 5, Reka UI 2, vee-validate + zod, Tailwind v4 (`@theme inline`), Vitest + @vue/test-utils (jsdom), Playwright, pnpm.

**Spec:** `/Users/sanji/WebstormProjects/over-track-api/docs/superpowers/specs/2026-10-19-overtrack-followups-design.md` (section 3 is the web half).

## Global Constraints

- Repo `/Users/sanji/WebstormProjects/over-track-web`. Gate before every commit: `pnpm lint && pnpm exec prettier --check "src/**/*.{ts,vue,css}" && pnpm test && pnpm build`.
- The API on `http://localhost:3000` must run the upgraded version (API follow-up plan merged, migrated and reseeded) before Task 1; user payloads carry `role: { id, name, level }`.
- No `confirm(`, `alert(`, `prompt(` or `window.confirm` anywhere in `src/` after Task 2; ESLint enforces it.
- Copy, verbatim: discard dialog title "Discard unsaved changes?", description "Your changes will be lost.", confirm "Discard", cancel "Keep editing". User delete title "Delete {name}?". Team delete title "Delete {name}?". Roles page title "Roles", menu label "Roles".
- Role levels, verbatim: `employee`, `manager`, `finance`, `admin`; labels `Employee`, `Manager`, `Finance`, `Admin`.
- Every touch target stays ≥ 44 px tall (`h-11`) except `size="sm"` buttons (36 px). Keep every `aria-label` that exists.
- Colours live only in `src/styles/tokens.css` and `src/assets/logo.svg`; components use token utilities (`bg-primary`, `text-muted-foreground`, …), never raw hex.
- vee-validate: always bind the `*Attrs` from `defineField` to the input (`v-bind="xAttrs"`).
- Tests use `createTestingPinia({ stubActions: false })` when a component calls `auth.can(...)`.

## Review Focus

1. Deleting a user who is the currently signed-in admin must not be offered; the row menu hides Delete for `auth.user.id`. Test in Task 5.
2. A drawer closed by the Escape key or overlay click while dirty must open the confirm dialog, not close silently and not close before the dialog resolves. Test in Task 2 (Drawer spec).
3. Reopening the entry drawer in edit mode right after an add must show the edited entry's values, not the blank form from the reset. Test in Task 3.
4. A role select whose roles query has not loaded yet must not submit an empty `roleId`; the submit button is disabled until roles arrive. Test in Task 4.
5. Dark mode must keep 4.5:1 for body text and badge text after the token change; Task 6 records measured ratios in its report.

---

### Task 1: Role types, API modules and the level-based permission switch

**Files:**
- Modify: `src/api/types.ts`, `src/api/users.api.ts`, `src/api/teams.api.ts`, `src/api/errors.ts`
- Create: `src/api/roles.api.ts`, `src/test/fixtures.ts`
- Modify: `src/lib/permissions.ts`, `src/stores/auth.store.ts`, `src/app/guards.ts` (types only)
- Modify: `src/features/sheets/components/SheetActions.vue`, `src/features/sheets/SheetPage.vue`, `src/features/approvals/ReviewSheetPage.vue`
- Modify: `src/features/admin/roles.ts`, `src/features/admin/UsersPage.vue`, `src/features/admin/UserFormDrawer.vue`, `src/features/profile/ProfilePage.vue`
- Test: every spec that builds a user fixture (`permissions.spec.ts`, `guards.spec.ts`, `auth.store.spec.ts`, `SheetActions.spec.ts`, `SheetPage.spec.ts`, `UserFormDrawer.spec.ts`, `DashboardPage.spec.ts`, `ProfilePage.spec.ts`, others found by `grep -rn "role: '" src`)

**Interfaces:**
- Produces: `RoleLevel`, `RoleRef`, `RoleView`, `PublicUser.role: RoleRef`; `rolesApi.list(): Promise<RoleView[]>`, `create`, `update`, `remove`; `usersApi.remove(id)`, `UserInput.roleId`, list filter `roleId`; `teamsApi.remove(id)`; `hasPerm` keyed on `user.role.level`; `LEVEL_OPTIONS`, `levelLabel(level)`; `makeUser(overrides)` test fixture.

- [ ] **Step 1: Types and API modules**

`src/api/types.ts`: replace the first line with

```ts
export type RoleLevel = 'employee' | 'manager' | 'finance' | 'admin';
export interface RoleRef { id: string; name: string; level: RoleLevel }
export interface RoleView extends RoleRef { isSystem: boolean; systemKey: string | null; userCount: number; createdAt: string; updatedAt: string }
```

and in `PublicUser` change `role: UserRole;` to `role: RoleRef;`. Delete `UserRole` everywhere (`grep -rn UserRole src`).

`src/api/roles.api.ts`:

```ts
import { get, post, patch, del } from './client';
import type { RoleLevel, RoleView } from './types';
export const rolesApi = {
  list: () => get<{ data: RoleView[] }>('/roles').then((r) => r.data),
  create: (b: { name: string; level: RoleLevel }) => post<{ data: RoleView }>('/roles', b).then((r) => r.data),
  update: (id: string, b: Partial<{ name: string; level: RoleLevel }>) =>
    patch<{ data: RoleView }>(`/roles/${id}`, b).then((r) => r.data),
  remove: (id: string) => del<void>(`/roles/${id}`),
};
```

`users.api.ts`: `UserInput.role: UserRole` → `roleId: string`; `DirectoryUser.role: RoleRef`; list query `role?: string` → `roleId?: string`; add `remove: (id: string) => del<void>(`/users/${id}`)`. `teams.api.ts`: add `remove: (id: string) => del<void>(`/teams/${id}`)`.

`errors.ts` MESSAGES: add
```ts
ROLE_NAME_TAKEN: 'A role with that name already exists.',
ROLE_IS_SYSTEM: 'Built-in roles cannot be deleted or re-levelled.',
ROLE_IN_USE: 'Users still have this role. Move them to another role first.',
CANNOT_DEMOTE_SELF: 'You cannot remove admin level from your own role.',
USER_HAS_HISTORY: 'This user has history (sheets, approvals or audit entries). Deactivate them instead.',
CANNOT_DELETE_SELF: 'You cannot delete your own account.',
TEAM_IN_USE: 'This team still has members or sheets. Move the members first, or deactivate the team.',
```

- [ ] **Step 2: Permissions and consumers**

`src/lib/permissions.ts`:

```ts
import type { PublicUser } from '@/api/types';
export type Perm = 'admin' | 'finance' | 'manager' | 'approver';
export function hasPerm(user: Pick<PublicUser, 'role'> | null, perm: Perm): boolean {
  if (!user) return false;
  const level = user.role.level;
  if (perm === 'admin') return level === 'admin';
  if (perm === 'finance') return level === 'finance' || level === 'admin';
  // 'manager' and 'approver' share the same level set; Inbox visibility is refined by data.
  return level === 'manager' || level === 'finance' || level === 'admin';
}
```

`auth.store.ts`: `const role = computed(() => user.value?.role ?? null)` stays (now a `RoleRef`); add `const level = computed(() => user.value?.role.level ?? null)` and export it.

`SheetActions.vue`: prop `role: UserRole` → `level: RoleLevel`; `canReopen` uses `props.level === 'admin'`. `SheetPage.vue:109` → `:level="auth.user?.role.level ?? 'employee'"`. `ReviewSheetPage.vue:43` → `auth.user?.role.level === 'admin'`.

`src/features/admin/roles.ts` becomes:

```ts
import type { RoleLevel } from '@/api/types';
export const LEVEL_OPTIONS: Array<{ value: RoleLevel; label: string; description: string }> = [
  { value: 'employee', label: 'Employee', description: 'Own sheets only. Can approve when named on a chain.' },
  { value: 'manager', label: 'Manager', description: 'Plus team month view and exports for teams whose chain names them.' },
  { value: 'finance', label: 'Finance', description: 'Manager rights for all teams, mark sheets paid, view own audit actions.' },
  { value: 'admin', label: 'Admin', description: 'Everything, including users, teams, chains, roles and overtime types.' },
];
export const levelLabel = (l: RoleLevel) => LEVEL_OPTIONS.find((o) => o.value === l)?.label ?? l;
```

`UsersPage.vue`: add `const roles = useQuery({ queryKey: ['roles'], queryFn: () => rolesApi.list() })`; the role filter `Select` options become `[{ value: 'all', label: 'All roles' }, ...(roles.data.value ?? []).map(r => ({ value: r.id, label: r.name }))]` and `params.roleId = role.value === 'all' ? undefined : role.value`; the Role column renders `row.original.role.name` with tone `row.original.role.level === 'admin' ? 'indigo' : 'neutral'`.

`UserFormDrawer.vue`: schema `role: z.enum([...])` → `roleId: z.string().min(1, 'Pick a role')`; `initialValues` uses `roleId: u.role.id` / `roleId: ''`; `const [roleId] = defineField('roleId')`; add `const roles = useQuery({ queryKey: ['roles'], queryFn: () => rolesApi.list() })` and `const roleOptions = computed(() => (roles.data.value ?? []).map(r => ({ value: r.id, label: r.name, description: levelLabel(r.level) })))`; the Role `Select` binds `:model-value="roleId || null"`, `:options="roleOptions"`, `placeholder="Pick a role"`; the submit button gets `:disabled="roles.isPending.value"`; the create/update bodies send `roleId`. When creating, default `roleId` to the role named `Employee` once roles load: `watch(roles.data, (list) => { if (!props.user && !roleId.value && list) roleId.value = list.find((r) => r.isSystem && r.level === 'employee')?.id ?? list[0]?.id ?? ''; }, { immediate: true })`.

`ProfilePage.vue:106` → `{{ auth.user?.role.name }}` (drop the `roleLabel` import).

- [ ] **Step 3: Test fixture and spec updates**

`src/test/fixtures.ts`:

```ts
import type { PublicUser, RoleLevel, RoleRef } from '@/api/types';
export const ROLES: Record<RoleLevel, RoleRef> = {
  employee: { id: 'r-emp', name: 'Employee', level: 'employee' },
  manager: { id: 'r-mgr', name: 'Tech Lead', level: 'manager' },
  finance: { id: 'r-fin', name: 'Finance', level: 'finance' },
  admin: { id: 'r-adm', name: 'Admin', level: 'admin' },
};
export function makeUser(o: Partial<Omit<PublicUser, 'role'>> & { level?: RoleLevel } = {}): PublicUser {
  const { level = 'employee', ...rest } = o;
  return {
    id: 'u1', firstName: 'Ada', lastName: 'Admin', email: 'ada@t.local', employeeCode: 'E1', teamId: null,
    timezone: 'UTC', isActive: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    role: ROLES[level], ...rest,
  };
}
```

Run `grep -rln "role: '" src` and replace each inline user literal with `makeUser({ level: 'admin' })` (or the matching level: tech_lead/delivery_manager/cto → `manager`). `permissions.spec.ts` asserts the same truth table through `makeUser`. `UserFormDrawer.spec.ts` mocks `rolesApi.list` to return `Object.values(ROLES)` and asserts the created payload carries `roleId: 'r-emp'`. Add a case "submit is disabled until roles load": mock `rolesApi.list` with a promise that never resolves, mount, and assert the `Send invite` button has the `disabled` attribute.

- [ ] **Step 4: Gate and commit**

Run the gate. Expected: lint clean, tests green (count may shift by a few), build OK.

```bash
git add -A && git commit -m "feat(roles): role levels, roles api, roleId in user forms"
```

---

### Task 2: Promise-based confirm dialog replaces browser prompts

**Files:**
- Create: `src/composables/useConfirm.ts`, `src/components/layout/ConfirmHost.vue`
- Modify: `src/components/ui/ConfirmDialog.vue` (add `cancelLabel`), `src/components/ui/Drawer.vue` (async `beforeClose` prop), `src/components/layout/AppShell.vue`
- Modify: `src/features/sheets/components/EntryForm.vue`, `src/features/admin/UserFormDrawer.vue`, `src/features/admin/TeamFormDrawer.vue`, `src/features/admin/ChainEditorPage.vue`
- Modify: `eslint.config.js`
- Test: `src/composables/useConfirm.spec.ts`, `src/components/ui/Drawer.spec.ts`

**Interfaces:**
- Produces: `useConfirm(): { confirm(opts: ConfirmOptions): Promise<boolean> }` with `ConfirmOptions = { title: string; description?: string; confirmLabel?: string; cancelLabel?: string; tone?: 'default' | 'destructive' }`; `discardGuard(isDirty: () => boolean): () => Promise<boolean>`; `Drawer` prop `beforeClose?: () => boolean | Promise<boolean>` (the `beforeClose` *event* is removed).

- [ ] **Step 1: Store and host**

`src/composables/useConfirm.ts`:

```ts
import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'destructive';
}

export const useConfirmStore = defineStore('confirm', () => {
  const open = ref(false);
  const options = ref<ConfirmOptions>({ title: '' });
  let resolver: ((v: boolean) => void) | null = null;
  function ask(o: ConfirmOptions): Promise<boolean> {
    resolver?.(false);
    options.value = o;
    open.value = true;
    return new Promise((resolve) => {
      resolver = resolve;
    });
  }
  function settle(v: boolean) {
    open.value = false;
    const r = resolver;
    resolver = null;
    r?.(v);
  }
  return { open, options, ask, settle };
});

export function useConfirm() {
  const store = useConfirmStore();
  return { confirm: (o: ConfirmOptions) => store.ask(o) };
}

/** Guard for drawers and route leaves: resolves true when there is nothing to lose or the user chose Discard. */
export function discardGuard(isDirty: () => boolean): () => Promise<boolean> {
  const { confirm } = useConfirm();
  return async () =>
    !isDirty() ||
    confirm({
      title: 'Discard unsaved changes?',
      description: 'Your changes will be lost.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      tone: 'destructive',
    });
}
```

`ConfirmDialog.vue`: add prop `cancelLabel?: string` (default `'Cancel'`) and render it on the outline button.

`src/components/layout/ConfirmHost.vue`:

```vue
<script setup lang="ts">
import { ConfirmDialog } from '@/components/ui';
import { useConfirmStore } from '@/composables/useConfirm';
const store = useConfirmStore();
</script>
<template>
  <ConfirmDialog
    :open="store.open"
    :title="store.options.title"
    :description="store.options.description"
    :confirm-label="store.options.confirmLabel ?? 'Confirm'"
    :cancel-label="store.options.cancelLabel ?? 'Cancel'"
    :destructive="store.options.tone === 'destructive'"
    @update:open="(v) => !v && store.settle(false)"
    @confirm="store.settle(true)"
  />
</template>
```

Mount `<ConfirmHost />` once in `src/App.vue`, directly after `<Toaster />`, so it is available on public pages too. (`AppShell.vue` is not touched in this task.)

- [ ] **Step 2: Async drawer guard**

`Drawer.vue`: replace the `beforeClose` emit with a prop:

```ts
const props = withDefaults(defineProps<{ open: boolean; title: string; description?: string; beforeClose?: () => boolean | Promise<boolean> }>(), { description: undefined, beforeClose: undefined });
const emit = defineEmits<{ 'update:open': [v: boolean] }>();
async function requestClose(next: boolean) {
  if (next) return emit('update:open', true);
  if (props.beforeClose && !(await props.beforeClose())) return;
  emit('update:open', false);
}
```

The template keeps `@update:open="requestClose"`, `@escape-key-down.prevent="requestClose(false)"`, `@pointer-down-outside.prevent="requestClose(false)"`.

- [ ] **Step 3: Replace the six prompts**

`EntryForm.vue`: delete `beforeClose`; `const guard = discardGuard(() => meta.value.dirty);` `async function cancel() { if (await guard()) emit('update:open', false); }`; `<Drawer … :before-close="guard">` and remove `@before-close`.

`UserFormDrawer.vue` and `TeamFormDrawer.vue`: same pattern; `requestClose` becomes `async function requestClose() { if (await guard()) emit('update:open', false); }`.

`ChainEditorPage.vue`: `const guard = discardGuard(() => dirty.value); onBeforeRouteLeave(() => guard());`.

`eslint.config.js` rules: add

```js
'no-restricted-globals': ['error', { name: 'confirm', message: 'Use useConfirm()' }, { name: 'alert', message: 'Use useToast()' }, { name: 'prompt', message: 'Use a Dialog' }],
'no-restricted-properties': ['error', { object: 'window', property: 'confirm' }, { object: 'window', property: 'alert' }, { object: 'window', property: 'prompt' }],
```

`grep -rn "confirm(" src` must only show `useConfirm`, local functions named `confirm` inside `MarkPaidDialog`/`DecisionDialog`/`ConfirmDialog`, and `confirm({` calls on the destructured composable.

- [ ] **Step 4: Tests**

`src/composables/useConfirm.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useConfirm, useConfirmStore, discardGuard } from './useConfirm';

describe('useConfirm', () => {
  beforeEach(() => setActivePinia(createPinia()));
  it('resolves true on settle(true) and false on settle(false)', async () => {
    const { confirm } = useConfirm();
    const store = useConfirmStore();
    const p1 = confirm({ title: 'A' });
    expect(store.open).toBe(true);
    store.settle(true);
    await expect(p1).resolves.toBe(true);
    const p2 = confirm({ title: 'B' });
    store.settle(false);
    await expect(p2).resolves.toBe(false);
    expect(store.open).toBe(false);
  });
  it('a second ask cancels the first', async () => {
    const { confirm } = useConfirm();
    const first = confirm({ title: 'A' });
    confirm({ title: 'B' });
    await expect(first).resolves.toBe(false);
  });
  it('discardGuard skips the dialog when clean', async () => {
    const store = useConfirmStore();
    await expect(discardGuard(() => false)()).resolves.toBe(true);
    expect(store.open).toBe(false);
  });
});
```

`Drawer.spec.ts`: add a case "escape waits for beforeClose": mount with `beforeClose` returning a deferred promise, trigger `escapeKeyDown` on the content, assert no `update:open` emitted yet, resolve `false`, assert still none, mount again with a guard resolving `true` and assert `update:open: [false]`.

- [ ] **Step 5: Gate and commit**

```bash
git add -A && git commit -m "feat(ui): promise-based confirm dialog replaces browser prompts"
```

---

### Task 3: Dashboard exact-active and entry form reset

**Files:**
- Modify: `src/components/layout/Sidebar.vue`, `src/features/sheets/components/EntryForm.vue`, `src/features/sheets/SheetPage.vue`
- Test: `src/components/layout/Sidebar.spec.ts`, `src/features/sheets/components/EntryForm.spec.ts`

- [ ] **Step 1: Sidebar**

In `Sidebar.vue` the `RouterLink` slot exposes `isExactActive`; change the slot destructure to `{ href, navigate, isActive, isExactActive }` and compute per item `const active = it.name === 'dashboard' ? isExactActive : isActive;` inside the template via a tiny helper: add `function activeFor(name: string, isActive: boolean, isExactActive: boolean) { return name === 'dashboard' ? isExactActive : isActive; }` in script and use `activeFor(it.name, isActive, isExactActive)` for `:class` and `aria-current`.

`src/components/layout/Sidebar.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { createRouter, createMemoryHistory } from 'vue-router';
import Sidebar from './Sidebar.vue';
import { useAuthStore } from '@/stores/auth.store';
import { makeUser } from '@/test/fixtures';

const Stub = { template: '<div />' };
async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', children: [
        { name: 'dashboard', path: '', component: Stub },
        { name: 'my-sheets', path: 'sheets', component: Stub },
        { name: 'sheet', path: 'sheets/:id', component: Stub },
        { name: 'inbox', path: 'approvals', component: Stub },
      ] },
    ],
  });
  await router.push(path);
  await router.isReady();
  const pinia = createTestingPinia({ stubActions: false });
  useAuthStore().setUser(makeUser({ level: 'employee' }));
  return mount(Sidebar, { global: { plugins: [router, pinia] } });
}

describe('Sidebar active state', () => {
  it('highlights only My sheets on a sheet page', async () => {
    const w = await mountAt('/sheets/123');
    const links = w.findAll('a');
    const current = links.filter((a) => a.attributes('aria-current') === 'page').map((a) => a.text());
    expect(current).toEqual(['My sheets']);
  });
  it('highlights Dashboard at /', async () => {
    const w = await mountAt('/');
    const current = w.findAll('a').filter((a) => a.attributes('aria-current') === 'page').map((a) => a.text());
    expect(current).toEqual(['Dashboard']);
  });
});
```

- [ ] **Step 2: Entry form reset**

`EntryForm.vue`:
- Add `function clear() { formError.value = ''; lastDerived.value = null; resetForm({ values: emptyValues() }); }`.
- Change the `open` watch: `(o) => { if (!o) { clear(); return; } … }` (keep the populate branch for `props.entry`).
- In `submit`, replace `resetForm({ values: { ...values } }); emit('saved', saved);` with:

```ts
emit('saved', saved);
if (props.entry) {
  emit('update:open', false);
} else {
  clear();
  await nextTick();
  document.getElementById('date')?.focus();
}
```
Import `nextTick` from vue. Remove the now-unused `values` from the `useForm` destructure.

`SheetPage.vue` `saved`: `async function saved(e: EntryView) { if (editing.value) editing.value = e; await invalidate(); }` so an add does not flip the open form into edit mode.

`EntryForm.spec.ts`: add three cases following the file's existing mocking style for `sheetsApi.addEntry`:
1. "clears after a successful add and keeps the drawer open": fill date/start/end/type/work item/description, submit, await flushPromises; assert `update:open` was not emitted, the Work item input value is `''`, the Hours input value is `''`.
2. "derives hours again after a reset": after case 1, set Start `18:00` and End `21:00`; assert Hours becomes `3`.
3. "closing while dirty and reopening shows a blank form": type a work item, set `open` to false then true (`await w.setProps({ open: false }); await w.setProps({ open: true })`); assert the Work item input is `''`.
4. "reopening in edit mode after an add shows that entry's values": after case 1, `await w.setProps({ open: false }); await w.setProps({ open: true, entry: savedEntry })` where `savedEntry` is the value the mocked `addEntry` resolved with (work item `E2E-1`); assert the Work item input is `E2E-1` and the drawer title is `Edit entry`.

- [ ] **Step 3: Gate and commit**

```bash
git add -A && git commit -m "fix(ui): exact-active dashboard link; entry form resets after add and on close"
```

---

### Task 4: Roles admin page

**Files:**
- Create: `src/features/admin/RolesPage.vue`, `src/features/admin/RoleFormDrawer.vue`
- Modify: `src/app/router.ts`, `src/components/layout/Sidebar.vue`
- Test: `src/features/admin/RolesPage.spec.ts`, `src/features/admin/RoleFormDrawer.spec.ts`

**Interfaces:**
- Consumes: `rolesApi`, `LEVEL_OPTIONS`, `levelLabel`, `useConfirm`, `discardGuard`.
- Produces: route `admin-roles` at `/admin/roles` (`meta: { perm: 'admin' }`); sidebar item "Roles" (icon `Shield` from lucide) between Teams and Overtime types.

- [ ] **Step 1: Route and menu**

`router.ts`: add after `admin-teams`: `{ name: 'admin-roles', path: 'admin/roles', component: () => import('@/features/admin/RolesPage.vue'), meta: { perm: 'admin' } }`. `Sidebar.vue`: add `{ name: 'admin-roles', label: 'Roles', icon: Shield, show: auth.can('admin'), group: 'Admin' }` after the Teams item; import `Shield`.

- [ ] **Step 2: RoleFormDrawer**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue';
import { useForm } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import { z } from 'zod';
import type { RoleLevel, RoleView } from '@/api/types';
import { rolesApi } from '@/api/roles.api';
import { ApiError, messageFor, fieldErrors } from '@/api/errors';
import { focusFirstInvalid } from '@/lib/forms';
import { discardGuard } from '@/composables/useConfirm';
import { useToast } from '@/components/ui/useToast';
import { Drawer, Button, FormField, Input, Select } from '@/components/ui';
import { LEVEL_OPTIONS } from './roles';

const props = defineProps<{ open: boolean; role?: RoleView | null }>();
const emit = defineEmits<{ 'update:open': [v: boolean]; saved: [r: RoleView] }>();
const { toast } = useToast();
const schema = toTypedSchema(
  z.object({
    name: z.string().trim().min(2, 'At least 2 characters').max(40),
    level: z.enum(['employee', 'manager', 'finance', 'admin']),
  }),
);
const initial = (r?: RoleView | null) => (r ? { name: r.name, level: r.level } : { name: '', level: 'employee' as RoleLevel });
const { handleSubmit, defineField, errors, setErrors, resetForm, isSubmitting, meta } = useForm({ validationSchema: schema, initialValues: initial(props.role) });
const [name, nameAttrs] = defineField('name', { validateOnBlur: true, validateOnModelUpdate: false });
const [level] = defineField('level');
const formError = ref('');
const levelOptions = LEVEL_OPTIONS.map((o) => ({ value: o.value, label: o.label, description: o.description }));
watch(() => props.open, (o) => { if (o) { formError.value = ''; resetForm({ values: initial(props.role) }); } });
const guard = discardGuard(() => meta.value.dirty);
async function requestClose() { if (await guard()) emit('update:open', false); }
const submit = handleSubmit(async (v) => {
  formError.value = '';
  try {
    const saved = props.role ? await rolesApi.update(props.role.id, props.role.isSystem ? { name: v.name } : v) : await rolesApi.create(v);
    toast({ title: props.role ? 'Role updated' : 'Role created', tone: 'success' });
    emit('saved', saved);
    emit('update:open', false);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'ROLE_NAME_TAKEN') setErrors({ name: messageFor(e) });
    else { setErrors(fieldErrors(e)); formError.value = messageFor(e); }
  }
}, focusFirstInvalid);
</script>
<template>
  <Drawer :open="open" :title="role ? 'Edit role' : 'New role'" description="The level decides what people with this role can do." :before-close="guard" @update:open="emit('update:open', $event)">
    <form id="role-form" class="space-y-4" novalidate @submit.prevent="submit">
      <p v-if="formError" role="alert" class="rounded-control border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{{ formError }}</p>
      <FormField label="Name" name="name" :error="errors.name" required>
        <template #default="{ id, invalid }">
          <Input :id="id" :model-value="name ?? ''" v-bind="nameAttrs" name="name" :invalid="invalid" @update:model-value="name = $event" />
        </template>
      </FormField>
      <FormField label="Level" name="level" :error="errors.level" :hint="role?.isSystem ? 'Built-in roles keep their level.' : LEVEL_OPTIONS.find((o) => o.value === level)?.description" required>
        <template #default="{ id, invalid }">
          <Select :id="id" :model-value="level ?? null" :options="levelOptions" :invalid="invalid" :disabled="role?.isSystem" @update:model-value="level = $event as RoleLevel" />
        </template>
      </FormField>
    </form>
    <template #footer>
      <Button variant="outline" @click="requestClose">Cancel</Button>
      <Button type="submit" form="role-form" :loading="isSubmitting">{{ role ? 'Save changes' : 'Create role' }}</Button>
    </template>
  </Drawer>
</template>
```

- [ ] **Step 3: RolesPage**

```vue
<script setup lang="ts">
import { h, ref } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import type { ColumnDef } from '@tanstack/vue-table';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-vue-next';
import { rolesApi } from '@/api/roles.api';
import type { RoleView } from '@/api/types';
import { messageFor } from '@/api/errors';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/components/ui/useToast';
import { PageHeader, Button, DataTable, Badge, DropdownMenu } from '@/components/ui';
import { levelLabel } from './roles';
import RoleFormDrawer from './RoleFormDrawer.vue';

const qc = useQueryClient();
const { toast } = useToast();
const { confirm } = useConfirm();
const q = useQuery({ queryKey: ['roles'], queryFn: () => rolesApi.list() });
const open = ref(false);
const editing = ref<RoleView | null>(null);
const invalidate = () => qc.invalidateQueries({ queryKey: ['roles'] });
function create() { editing.value = null; open.value = true; }
async function remove(r: RoleView) {
  const ok = await confirm({ title: `Delete ${r.name}?`, description: 'People cannot be assigned this role any more. Roles with users cannot be deleted.', confirmLabel: 'Delete', tone: 'destructive' });
  if (!ok) return;
  try {
    await rolesApi.remove(r.id);
    toast({ title: 'Role deleted', tone: 'success' });
    await invalidate();
  } catch (e) {
    toast({ title: messageFor(e), tone: 'error' });
  }
}
const levelTone = { employee: 'neutral', manager: 'info', finance: 'success', admin: 'indigo' } as const;
const columns: ColumnDef<RoleView, unknown>[] = [
  { accessorKey: 'name', header: 'Name', cell: ({ row }) => h('span', { class: 'font-medium' }, row.original.name) },
  { accessorKey: 'level', header: 'Level', cell: ({ row }) => h(Badge, { tone: levelTone[row.original.level] }, () => levelLabel(row.original.level)) },
  { accessorKey: 'userCount', header: 'Users', meta: { numeric: true } },
  { id: 'system', header: '', cell: ({ row }) => (row.original.isSystem ? h(Badge, { tone: 'neutral' }, () => 'Built-in') : null) },
  {
    id: 'actions', header: '',
    cell: ({ row }) => h(DropdownMenu, {
      items: [
        { label: 'Edit', icon: Pencil, onSelect: () => { editing.value = row.original; open.value = true; } },
        ...(row.original.isSystem ? [] : [{ label: 'Delete', icon: Trash2, destructive: true, onSelect: () => remove(row.original) }]),
      ],
    }, { trigger: () => h(Button, { variant: 'ghost', size: 'sm', 'aria-label': `Actions for ${row.original.name}` }, () => h(MoreHorizontal, { class: 'h-4 w-4' })) }),
  },
];
</script>
<template>
  <PageHeader title="Roles" description="Name the roles your company uses. The level decides permissions.">
    <template #actions><Button @click="create">New role</Button></template>
  </PageHeader>
  <DataTable :columns="columns" :rows="q.data.value ?? []" :row-key="(r) => r.id" :loading="q.isPending.value" :error="q.isError.value ? messageFor(q.error.value) : null" empty-title="No roles" @retry="q.refetch()" />
  <RoleFormDrawer v-model:open="open" :role="editing" @saved="invalidate()" />
</template>
```

- [ ] **Step 4: Tests**

`RolesPage.spec.ts` (mock `@/api/roles.api`, mount with `VueQueryPlugin` and `createTestingPinia({ stubActions: false })`, stubs as the other page specs do): (1) renders a row per role with the level label; (2) the Built-in badge shows for system roles; (3) opening the actions menu of a system role shows no Delete item, of a custom role shows Delete; (4) choosing Delete asks the confirm store (assert `useConfirmStore().open === true`), and `settle(true)` calls `rolesApi.remove` with the id.

`RoleFormDrawer.spec.ts`: (1) name shorter than 2 shows "At least 2 characters" and does not call the API; (2) create submits `{ name: 'QA Lead', level: 'manager' }`; (3) editing a system role sends only `{ name }`.

- [ ] **Step 5: Gate and commit**

```bash
git add -A && git commit -m "feat(admin): roles page with create, rename, re-level and delete"
```

---

### Task 5: Delete actions for users and teams, toast actions

**Files:**
- Modify: `src/components/ui/useToast.ts`, `src/components/ui/Toaster.vue`
- Modify: `src/features/admin/UsersPage.vue`, `src/features/admin/TeamsPage.vue`
- Test: `src/components/ui/useToast.spec.ts`, `src/features/admin/UsersPage.spec.ts`, `src/features/admin/TeamsPage.spec.ts`

**Interfaces:**
- Produces: `toast({ …, action?: { label: string; onClick: () => void } })`; the Toaster renders the action as a `size="sm"` outline button and dismisses the toast when clicked.

- [ ] **Step 1: Toast action**

`useToast.ts`: add `action?: { label: string; onClick: () => void }` to `Toast` and to the `toast()` options, copied through. Toasts with an action auto-dismiss after 8000 ms instead of 4000. `Toaster.vue`: under the description render `<Button v-if="t.action" variant="outline" size="sm" class="mt-2" @click="t.action.onClick(); dismiss(t.id)">{{ t.action.label }}</Button>`. `useToast.spec.ts`: add "keeps the action and uses the longer timeout" (use `vi.useFakeTimers()`).

- [ ] **Step 2: Users page**

In `UsersPage.vue`: import `Trash2`, `useAuthStore`, `useConfirm`, `ApiError`. Add

```ts
const auth = useAuthStore();
const { confirm } = useConfirm();
async function remove(u: PublicUser) {
  const ok = await confirm({
    title: `Delete ${fullName(u)}?`,
    description: 'This removes the account permanently. Users with sheets or approvals cannot be deleted and should be deactivated instead.',
    confirmLabel: 'Delete', tone: 'destructive',
  });
  if (!ok) return;
  try {
    await usersApi.remove(u.id);
    toast({ title: 'User deleted', tone: 'success' });
    await invalidate();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'USER_HAS_HISTORY' && u.isActive) {
      toast({ title: messageFor(e), tone: 'error', action: { label: 'Deactivate instead', onClick: () => { toggling.value = u; } } });
    } else {
      toast({ title: messageFor(e), tone: 'error' });
    }
  }
}
```

In the actions column, after the Deactivate/Reactivate item, append `...(row.original.id === auth.user?.id ? [] : [{ label: 'Delete', icon: Trash2, destructive: true, onSelect: () => remove(row.original) }])`.

- [ ] **Step 3: Teams page**

In `TeamsPage.vue`: import `Trash2`, `useConfirm`, `useToast`, `messageFor`. Add

```ts
const { confirm } = useConfirm();
const { toast } = useToast();
async function remove(t: TeamSummary) {
  const ok = await confirm({ title: `Delete ${t.name}?`, description: 'Its approval chain is removed too. Teams with members or sheets cannot be deleted.', confirmLabel: 'Delete', tone: 'destructive' });
  if (!ok) return;
  try {
    await teamsApi.remove(t.id);
    toast({ title: 'Team deleted', tone: 'success' });
    await qc.invalidateQueries({ queryKey: ['teams'] });
  } catch (e) {
    toast({ title: messageFor(e), tone: 'error' });
  }
}
```

and a third ghost button in the actions cell: `h(Button, { variant: 'ghost', size: 'sm', 'aria-label': `Delete team ${row.original.name}`, onClick: () => remove(row.original) }, () => h(Trash2, { class: 'h-4 w-4 text-destructive' }))`.

- [ ] **Step 4: Tests**

`UsersPage.spec.ts` (mock `usersApi`, `teamsApi`, `rolesApi`): (1) the signed-in admin's own row menu has no Delete; (2) another user's menu has Delete; choosing it opens the confirm store; `settle(true)` calls `usersApi.remove`; (3) when `usersApi.remove` rejects with `new ApiError(409, 'USER_HAS_HISTORY', '…')`, a toast with the action label "Deactivate instead" is rendered (mount `Toaster` alongside or inspect `useToast().toasts`).

`TeamsPage.spec.ts`: (1) the delete button exists per row; (2) confirm → `teamsApi.remove`; (3) a 409 `TEAM_IN_USE` shows the mapped message in `useToast().toasts`.

- [ ] **Step 5: Gate and commit**

```bash
git add -A && git commit -m "feat(admin): delete users and teams with confirm dialogs and toast actions"
```

---

### Task 6: Visual refresh

**Files:**
- Modify: `src/styles/tokens.css`, `src/styles/base.css`, `index.html`, `public/favicon.svg`
- Create: `src/assets/logo.svg`, `src/components/layout/BrandMark.vue`
- Modify: `src/components/layout/AppShell.vue`, `src/components/layout/Sidebar.vue`, `src/components/layout/Topbar.vue`, `src/features/auth/AuthCard.vue`
- Modify: `src/components/ui/StatTile.vue`, `src/components/ui/StatusBadge.vue`, `src/components/ui/Badge.vue`, `src/components/ui/Card.vue`, `src/components/ui/PageHeader.vue`, `src/components/ui/DataTable.vue` (header row classes only), `src/components/ui/Button.vue` (secondary variant)
- Modify: `src/features/dashboard/DashboardPage.vue` (greeting card)
- Test: `src/components/ui/StatusBadge.spec.ts` (tone map), `src/components/layout/BrandMark.spec.ts`

- [ ] **Step 1: Tokens**

Replace `src/styles/tokens.css` entirely:

```css
@import 'tailwindcss';
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --primary: #4f46e5;
  --on-primary: #ffffff;
  --primary-soft: #eef2ff;
  --secondary: #6366f1;
  --on-secondary: #ffffff;
  --accent: #047857;
  --on-accent: #ffffff;
  --accent-soft: #ecfdf5;
  --warning: #b45309;
  --warning-soft: #fffbeb;
  --destructive: #b91c1c;
  --on-destructive: #ffffff;
  --destructive-soft: #fef2f2;
  --background: #f5f3ff;
  --surface: #ffffff;
  --foreground: #1e1b4b;
  --muted: #eef0f7;
  --muted-foreground: #5b6478;
  --border: #e0e7ff;
  --ring: #4f46e5;
  --indigo: #4f46e5;
  --paid: #047857;
  --paid-soft: #d1fae5;
  --sidebar: #1e1b4b;
  --sidebar-foreground: #eef2ff;
  --sidebar-muted: #a5b4fc;
  --sidebar-active: rgb(255 255 255 / 0.12);
  --sidebar-hover: rgb(255 255 255 / 0.08);
}
.dark {
  --primary: #a5b4fc;
  --on-primary: #1e1b4b;
  --primary-soft: rgb(165 180 252 / 0.15);
  --secondary: #818cf8;
  --on-secondary: #1e1b4b;
  --accent: #34d399;
  --on-accent: #052e22;
  --accent-soft: rgb(52 211 153 / 0.15);
  --warning: #fbbf24;
  --warning-soft: rgb(251 191 36 / 0.15);
  --destructive: #f87171;
  --on-destructive: #2b0a0a;
  --destructive-soft: rgb(248 113 113 / 0.15);
  --background: #0f0e1a;
  --surface: #1a1930;
  --foreground: #e0e7ff;
  --muted: #262541;
  --muted-foreground: #9ca3c4;
  --border: #312e5e;
  --ring: #a5b4fc;
  --indigo: #a5b4fc;
  --paid: #34d399;
  --paid-soft: rgb(52 211 153 / 0.15);
  --sidebar: #14132a;
  --sidebar-foreground: #e0e7ff;
  --sidebar-muted: #8b93c7;
  --sidebar-active: rgb(165 180 252 / 0.18);
  --sidebar-hover: rgb(165 180 252 / 0.1);
}

@theme inline {
  --color-primary: var(--primary);
  --color-on-primary: var(--on-primary);
  --color-primary-soft: var(--primary-soft);
  --color-secondary: var(--secondary);
  --color-on-secondary: var(--on-secondary);
  --color-accent: var(--accent);
  --color-on-accent: var(--on-accent);
  --color-accent-soft: var(--accent-soft);
  --color-warning: var(--warning);
  --color-warning-soft: var(--warning-soft);
  --color-destructive: var(--destructive);
  --color-on-destructive: var(--on-destructive);
  --color-destructive-soft: var(--destructive-soft);
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-ring: var(--ring);
  --color-indigo: var(--indigo);
  --color-paid: var(--paid);
  --color-paid-soft: var(--paid-soft);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-muted: var(--sidebar-muted);
  --color-sidebar-active: var(--sidebar-active);
  --color-sidebar-hover: var(--sidebar-hover);
  --font-sans: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'Fira Code', ui-monospace, monospace;
  --radius-control: 8px;
  --radius-card: 12px;
  --shadow-card: 0 1px 2px rgb(30 27 75 / 0.06), 0 4px 12px rgb(30 27 75 / 0.06);
  --shadow-dialog: 0 10px 30px rgb(30 27 75 / 0.25);
}
```

The spec listed `#059669` for accent and `#d97706` for warning; they are darkened to `#047857` and `#b45309` so text in those colours on white and on the soft backgrounds meets 4.5:1 (ruled deviation, record it in the report with the measured ratios).

`base.css`: in `@layer base` add
```css
h1, h2, h3 { @apply font-semibold tracking-tight; }
```
and keep everything else.

`index.html`: replace the Google Fonts link with
```html
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet" />
```

- [ ] **Step 2: Logo**

`src/assets/logo.svg` (also copied verbatim to `public/favicon.svg`):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="OverTrack">
  <rect width="32" height="32" rx="8" fill="#4f46e5"/>
  <circle cx="15" cy="15" r="9" fill="none" stroke="#ffffff" stroke-width="2.5"/>
  <path d="M15 9.5V15l3.8 2.4" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="24" cy="24" r="6" fill="#059669" stroke="#ffffff" stroke-width="1.5"/>
  <path d="M21.4 24l1.8 1.8 3.4-3.6" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

`src/components/layout/BrandMark.vue`:

```vue
<script setup lang="ts">
import logoUrl from '@/assets/logo.svg';
withDefaults(defineProps<{ size?: number; wordmark?: boolean; light?: boolean }>(), { size: 32, wordmark: true, light: false });
</script>
<template>
  <span class="inline-flex items-center gap-2.5">
    <img :src="logoUrl" alt="" :width="size" :height="size" class="shrink-0 rounded-[25%]" />
    <span v-if="wordmark" class="text-lg font-bold tracking-tight" :class="light ? 'text-sidebar-foreground' : 'text-foreground'">OverTrack</span>
  </span>
</template>
```

`BrandMark.spec.ts`: renders the image with `alt=""` and the wordmark text; hides the wordmark when `wordmark` is false.

- [ ] **Step 3: Shell, sidebar and topbar**

`AppShell.vue`: the desktop `aside` classes become `hidden flex-col bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-dvh`; its header `div` becomes `<div class="flex h-14 items-center px-4"><BrandMark :wordmark="!ui.sidebarCollapsed" light /></div>`. The mobile `DialogContent` gets `bg-sidebar text-sidebar-foreground` and its `DialogTitle` wraps `<BrandMark light />`. Mount `<ConfirmHost />` here if Task 2 did not already.

`Sidebar.vue` link classes: active → `bg-sidebar-active font-semibold text-white` with a left bar via `before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary-soft` (add `relative` to the link); inactive → `text-sidebar-foreground/80 hover:bg-sidebar-hover hover:text-sidebar-foreground`. Group labels `text-sidebar-muted`. Badge `bg-primary-soft text-primary` (light) stays readable on the dark sidebar because the badge carries its own background. Collapse button `text-sidebar-muted hover:bg-sidebar-hover`.

`Topbar.vue`: replace the mobile `<span>OverTrack</span>` with `<BrandMark :size="28" class="lg:hidden" />`. `AppShell.vue` keeps its `<ConfirmHost />`-free template; the host lives in `App.vue` since Task 2.

- [ ] **Step 4: Kit components**

- `Badge.vue` tones: `neutral: 'bg-muted text-muted-foreground'`, `info: 'bg-primary-soft text-primary'`, `success: 'bg-accent-soft text-accent'`, `warning: 'bg-warning-soft text-warning'`, `danger: 'bg-destructive-soft text-destructive'`, `indigo: 'bg-primary-soft text-indigo'`; add `paid: 'bg-paid-soft text-paid'` and extend the prop union.
- `StatusBadge.vue` map: draft `neutral`, submitted `info`, approved `success`, paid `paid`, rejected `danger`. Update `StatusBadge.spec.ts` tone assertions.
- `StatTile.vue`: the icon wrapper becomes `rounded-full p-2.5` with tone classes `{ neutral: 'bg-muted text-foreground', info: 'bg-primary-soft text-primary', success: 'bg-accent-soft text-accent', warning: 'bg-warning-soft text-warning', danger: 'bg-destructive-soft text-destructive', indigo: 'bg-primary-soft text-indigo' }` (default `info`); the value keeps `num text-2xl font-bold`.
- `Card.vue`: `rounded-card bg-surface shadow-card border border-transparent dark:border-border`.
- `PageHeader.vue`: title `text-[28px] font-bold leading-tight`.
- `Button.vue`: `secondary: 'bg-primary-soft text-primary hover:bg-primary/15'`, `outline: 'border bg-surface text-foreground hover:bg-muted'` unchanged, `primary` unchanged.
- `DataTable.vue`: the `<thead>` row classes become `bg-muted text-xs font-medium uppercase tracking-wide text-muted-foreground`; clickable row hover `hover:bg-primary-soft/40`.
- `PageHeader.vue`: add a boolean prop `compact` (default `false`); the root `div` uses `:class="compact ? '' : 'mb-6'"` in place of the static `mb-6`.
- `DashboardPage.vue`: wrap the `PageHeader` in `<div class="mb-6 rounded-card bg-gradient-to-r from-primary-soft to-surface p-5 shadow-card">` and pass `compact` to the header.
- `AuthCard.vue`: outer `bg-gradient-to-br from-primary-soft to-background`; replace the "OverTrack" `<p>` with `<div class="mb-6 flex justify-center"><BrandMark :size="48" /></div>`.

- [ ] **Step 5: Verify**

Run the gate, then `pnpm dev` with the API up and check light and dark mode on the login page, dashboard, a sheet, the inbox and an admin page at 375 px and 1280 px. Measure contrast for: body text on background, muted text on surface, each badge tone text on its soft background, sidebar text and muted text on the sidebar, in both modes, with a contrast checker (for example `npx wcag-contrast` or the browser devtools picker). Record the ratios in the task report; every pair must be ≥ 4.5:1.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ui): indigo/emerald theme, Plus Jakarta Sans, logo and dark sidebar"
```

---

### Task 7: Playwright flow and README

**Files:**
- Create: `e2e/04-admin-roles-and-deletes.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Spec**

```ts
import { test, expect } from '@playwright/test';
import { login, goToNav } from './helpers';

test('admin manages roles and deletes are guarded', async ({ page }) => {
  await login(page, 'admin@overtrack.local');

  await goToNav(page, 'Roles');
  await page.getByRole('button', { name: 'New role' }).click();
  await page.getByLabel('Name').fill('QA Lead');
  await page.getByLabel('Level').click();
  await page.getByRole('option', { name: 'Manager' }).click();
  await page.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByText('Role created')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'QA Lead' })).toHaveCount(1);

  await goToNav(page, 'Users');
  await page.getByLabel('Search').fill('emp3.mobile');
  const row = page.getByRole('row').filter({ hasText: 'emp3.mobile@overtrack.local' });
  await row.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByLabel('Role').click();
  await page.getByRole('option', { name: 'QA Lead' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('User updated')).toBeVisible();

  await goToNav(page, 'Roles');
  await page.getByRole('button', { name: 'Actions for QA Lead' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(/Users still have this role/)).toBeVisible();

  await goToNav(page, 'Teams');
  await page.getByRole('button', { name: 'Delete team Platform' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(/still has members or sheets/)).toBeVisible();

  await goToNav(page, 'Users');
  await page.getByRole('button', { name: 'Invite user' }).click();
  await page.getByLabel('First name').fill('Temp');
  await page.getByLabel('Last name').fill('Person');
  await page.getByLabel('Email').fill('temp.e2e@overtrack.local');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText('Invite sent')).toBeVisible();
  await page.getByLabel('Search').fill('temp.e2e');
  const temp = page.getByRole('row').filter({ hasText: 'temp.e2e@overtrack.local' });
  await temp.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('User deleted')).toBeVisible();
  await expect(temp).toHaveCount(0);
});
```

If a selector does not match the rendered markup, fix the selector, not the markup, unless the markup lacks an accessible name (then add the `aria-label` the plan specifies).

- [ ] **Step 2: README**

In the e2e section, change "run in file order (`01-` to `03-`)" to "(`01-` to `04-`)" and add one line: "`04-` creates a role, re-assigns a user, exercises the delete guards and deletes a throwaway user."

- [ ] **Step 3: Run and commit**

Reseed the API (`cd ../over-track-api && docker compose down -v && docker compose up -d && pnpm db:migrate && rm -rf dist && pnpm seed`, then start it), run `pnpm e2e`, reseed again and run `pnpm e2e:mobile`. Expected: 6/6 in each.

```bash
git add -A && git commit -m "test(e2e): admin roles and delete guards flow"
```
