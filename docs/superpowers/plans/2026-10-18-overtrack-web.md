# OverTrack Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `over-track-web` Vue 3 frontend for OverTrack: employee sheets, approver inbox, team month view, payments, and admin screens, against the API defined in the API plan.

**Architecture:** Vite + Vue 3.5 single-page app. Server state through TanStack Query, client state through three Pinia stores (auth, ui, notifications). A thin fetch client with refresh-on-401 wraps the API. About 20 wrapped UI components over Reka UI primitives and Tailwind v4 semantic tokens; feature folders own their pages and domain components.

**Tech Stack:** Node 22, pnpm, Vite 6, Vue 3.5, TypeScript strict, Vue Router 4, Pinia 3, @tanstack/vue-query 5, @tanstack/vue-table 8, Tailwind CSS 4 (`@tailwindcss/vite`), reka-ui 2, lucide-vue-next, vee-validate 4 + @vee-validate/zod + zod 3, date-fns 4, Vitest 3 + @vue/test-utils + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-overtrack-design.md` in the `over-track-api` repo (sections 6, 7, 8). API contract: `docs/superpowers/plans/2026-10-18-overtrack-api.md` (the "Interfaces" blocks of each task are the response shapes this plan consumes).

**Repo location:** `/Users/sanji/WebstormProjects/over-track-web` (separate git repo; this plan file lives in the API repo).

**Deviation from spec 6.1:** the API plan does not declare OpenAPI response schemas, so `openapi-typescript` would generate `unknown` responses. This plan hand-writes the response types in `src/api/types.ts`, mirroring the API plan's Interfaces blocks. Switch to generated types later if the API adds `@ApiResponse` schemas.

## Global Constraints

- Node ≥ 22, pnpm ≥ 9, TypeScript `strict: true`, `<script setup lang="ts">` everywhere.
- API base URL from `VITE_API_URL` (default `http://localhost:3000/api/v1`). Refresh cookie is sent with `credentials: 'include'`.
- Access token lives in memory only (Pinia), never in `localStorage`. `localStorage` holds only theme and sidebar state.
- Colors only through semantic tokens (`bg-background`, `text-foreground`, `bg-primary`, …). No raw hex in components.
- Fonts: Fira Sans (UI), Fira Code (hours, periods, codes, references) with `tabular-nums`.
- Status badge always = icon + label + color. Lucide icons only, 20px, stroke 1.75. No emoji icons.
- Base font 16px, 8px spacing rhythm, radius 6px controls / 10px cards, transitions 150–250ms, `prefers-reduced-motion` respected.
- Every async button shows a spinner and is disabled while pending. Every list has loading (skeleton), empty and error (with retry) states.
- Destructive or irreversible actions confirm in a Dialog: delete entry, submit, reject, mark paid, revert, reopen, deactivate.
- Toasts auto-dismiss after 4 s, `aria-live="polite"`.
- Errors: `VALIDATION_FAILED` details map to fields; other codes map through `lib/errors.ts`; unknown → "Something went wrong".
- Mobile: no horizontal page scroll at 375px; tables scroll inside their card; sidebar becomes a drawer below 1024px.
- Commit after every task with a conventional-commit message.

## Review Focus

1. **Access token expires while the user is mid-form** — the next request must refresh silently once and retry, not bounce the user to login and lose the form. (Test added to Task 5.)
2. **Sheet page opened via a stale notification link after the sheet was reopened or paid** — the actions bar must reflect the current status and the version in the store, never show Submit on a paid sheet. (Test added to Task 10.)
3. **409 SHEET_VERSION_CONFLICT on approve/submit** — show a "reload" toast and refetch; do not leave the button spinning or silently swallow. (Test added to Task 10.)
4. **Entry form with the browser's date input returning an empty string** (user clears the date) — must show a field error, not send `""` to the API. (Test added to Task 9.)
5. **Deep-linking to an admin route as an employee** — redirect to the dashboard with a toast, not a blank page or infinite redirect. (Test added to Task 6.)

---

## File structure

```
over-track-web/
  package.json  vite.config.ts  tsconfig.json  tsconfig.app.json  tsconfig.node.json  vitest.config.ts  playwright.config.ts
  eslint.config.js  .prettierrc  .env.example  .gitignore  index.html  Dockerfile  nginx.conf
  public/favicon.svg
  src/
    main.ts  App.vue
    app/router.ts  app/guards.ts  app/query.ts
    styles/tokens.css  styles/base.css
    api/client.ts  api/errors.ts  api/types.ts
    api/auth.api.ts users.api.ts teams.api.ts chains.api.ts overtime-types.api.ts sheets.api.ts workflow.api.ts inbox.api.ts
        notifications.api.ts reports.api.ts audit.api.ts
    stores/auth.store.ts  stores/ui.store.ts  stores/notifications.store.ts
    lib/format.ts  lib/dates.ts  lib/permissions.ts  lib/download.ts
    components/ui/   (one .vue per component, see Tasks 2–4)  + useToast.ts
    components/layout/AppShell.vue Sidebar.vue Topbar.vue UserMenu.vue NotificationsMenu.vue ThemeToggle.vue
    features/auth/        LoginPage.vue AcceptInvitePage.vue ForgotPasswordPage.vue ResetPasswordPage.vue AuthCard.vue
    features/dashboard/   DashboardPage.vue
    features/sheets/      MySheetsPage.vue SheetPage.vue components/EntryForm.vue EntriesTable.vue SheetTotals.vue SheetActions.vue RejectionBanner.vue ApprovalTimeline.vue entry.schema.ts
    features/approvals/   InboxPage.vue ReviewSheetPage.vue components/DecisionDialog.vue
    features/reports/     TeamMonthPage.vue components/TeamMonthTable.vue ExportButton.vue
    features/payments/    PaymentsPage.vue components/MarkPaidDialog.vue
    features/admin/       UsersPage.vue UserFormDrawer.vue TeamsPage.vue TeamFormDrawer.vue ChainEditorPage.vue OvertimeTypesPage.vue AuditLogPage.vue
    features/profile/     ProfilePage.vue
  tests/  (unit specs next to source as *.spec.ts; e2e under e2e/)
  e2e/employee-submit.spec.ts approver-decide.spec.ts finance-pay.spec.ts
```

---

### Task 1: Scaffold, Tailwind tokens, base styles, formatting helpers

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig*.json`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.env.example`, `.gitignore`, `index.html`, `src/main.ts`, `src/App.vue`, `src/styles/tokens.css`, `src/styles/base.css`, `src/lib/format.ts`, `src/lib/format.spec.ts`, `src/lib/dates.ts`, `src/lib/dates.spec.ts`, `src/app/query.ts`

**Interfaces:**
- Produces: `formatHours(2.5) → '2.50'`, `formatPeriod('2026-09') → 'September 2026'`, `formatDate('2026-09-10') → '10 Sep 2026'`, `formatDateTime(iso) → '10 Sep 2026, 14:05'`, `fullName({firstName,lastName})`, `initials(...)`; `currentPeriod()`, `previousPeriod(p)`, `nextPeriod(p)`, `todayIso()`, `periodBounds('2026-09') → { min: '2026-09-01', max: '2026-09-30' }`; `queryClient` with sane defaults.

- [ ] **Step 1: Scaffold**

```bash
cd /Users/sanji/WebstormProjects/over-track-web
git init
pnpm create vite@latest . --template vue-ts   # accept "current directory"
pnpm install
pnpm add vue-router@^4 pinia@^3 @tanstack/vue-query@^5 @tanstack/vue-table@^8 reka-ui@^2 lucide-vue-next vee-validate@^4 @vee-validate/zod zod@^3.25 date-fns@^4 @vueuse/core
pnpm add -D tailwindcss@^4 @tailwindcss/vite@^4 vitest@^3 jsdom @vue/test-utils @pinia/testing eslint@^9 @eslint/js typescript-eslint eslint-plugin-vue prettier vue-tsc @playwright/test
```

- [ ] **Step 2: Config files**

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173 },
});
```

`vitest.config.ts`:
```ts
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';
export default mergeConfig(viteConfig, defineConfig({
  test: { environment: 'jsdom', include: ['src/**/*.spec.ts'], globals: false, setupFiles: ['src/test-setup.ts'], css: false },
}));
```

`src/test-setup.ts`:
```ts
import { config } from '@vue/test-utils';
// Reka UI uses ResizeObserver and matchMedia in jsdom
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
config.global.stubs = { teleport: true };
```

`tsconfig.app.json` (merge into the generated one): add `"paths": { "@/*": ["./src/*"] }`, `"baseUrl": "."`, `"strict": true`, `"noUnusedLocals": true`, and include `src/**/*.spec.ts`.

`eslint.config.js`:
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'e2e-results'] },
  js.configs.recommended, ...tseslint.configs.recommended, ...vue.configs['flat/recommended'],
  { files: ['**/*.vue'], languageOptions: { parserOptions: { parser: tseslint.parser } } },
  { rules: { 'vue/multi-word-component-names': 'off', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
```

`.prettierrc`: `{ "singleQuote": true, "trailingComma": "all", "printWidth": 110, "semi": true }`

`.env.example`:
```
VITE_API_URL=http://localhost:3000/api/v1
```

`package.json` scripts:
```json
{
  "dev": "vite", "build": "vue-tsc -b && vite build", "preview": "vite preview",
  "test": "vitest run", "test:watch": "vitest", "e2e": "playwright test",
  "lint": "eslint \"src/**/*.{ts,vue}\"", "format": "prettier --write \"src/**/*.{ts,vue,css}\""
}
```

`.gitignore`: add `dist`, `node_modules`, `.env`, `e2e-results`, `playwright-report`.

`index.html` head:
```html
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" href="/favicon.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&family=Fira+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
<title>OverTrack</title>
<script>try{if(localStorage.getItem('ot.theme')==='dark'||(!localStorage.getItem('ot.theme')&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}</script>
```

- [ ] **Step 3: Tokens and base styles**

`src/styles/tokens.css`:
```css
@import 'tailwindcss';
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --primary: #1e3a5f; --on-primary: #ffffff; --secondary: #2563eb; --on-secondary: #ffffff;
  --accent: #059669; --on-accent: #ffffff; --destructive: #dc2626; --on-destructive: #ffffff;
  --background: #f8fafc; --surface: #ffffff; --foreground: #0f172a; --muted: #f1f3f5; --muted-foreground: #475569;
  --border: #e4e7eb; --ring: #1e3a5f; --indigo: #4f46e5; --warning: #d97706;
}
.dark {
  --primary: #93b4e0; --on-primary: #0b1a2e; --secondary: #60a5fa; --on-secondary: #0b1a2e;
  --accent: #34d399; --on-accent: #052e22; --destructive: #f87171; --on-destructive: #2b0a0a;
  --background: #0f172a; --surface: #1e293b; --foreground: #e2e8f0; --muted: #273449; --muted-foreground: #94a3b8;
  --border: #334155; --ring: #93b4e0; --indigo: #a5b4fc; --warning: #fbbf24;
}

@theme inline {
  --color-primary: var(--primary); --color-on-primary: var(--on-primary);
  --color-secondary: var(--secondary); --color-on-secondary: var(--on-secondary);
  --color-accent: var(--accent); --color-on-accent: var(--on-accent);
  --color-destructive: var(--destructive); --color-on-destructive: var(--on-destructive);
  --color-background: var(--background); --color-surface: var(--surface); --color-foreground: var(--foreground);
  --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border); --color-ring: var(--ring); --color-indigo: var(--indigo); --color-warning: var(--warning);
  --font-sans: 'Fira Sans', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'Fira Code', ui-monospace, monospace;
  --radius-control: 6px; --radius-card: 10px;
  --shadow-card: 0 1px 2px rgb(15 23 42 / 0.06), 0 1px 3px rgb(15 23 42 / 0.1);
  --shadow-dialog: 0 10px 30px rgb(15 23 42 / 0.25);
}
```

`src/styles/base.css`:
```css
@import './tokens.css';

html { font-size: 16px; }
body { @apply bg-background text-foreground font-sans antialiased; line-height: 1.5; }
* { @apply border-border; }
.num { @apply font-mono tabular-nums; }
:focus-visible { @apply outline-none ring-2 ring-ring ring-offset-2 ring-offset-background; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
.skip-link { @apply sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:rounded-control; }
```

- [ ] **Step 4: Failing tests for helpers**

`src/lib/format.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatHours, formatPeriod, formatDate, formatDateTime, fullName, initials } from './format';
describe('format', () => {
  it('hours with two decimals', () => { expect(formatHours(2.5)).toBe('2.50'); expect(formatHours(0)).toBe('0.00'); });
  it('period', () => expect(formatPeriod('2026-09')).toBe('September 2026'));
  it('date', () => expect(formatDate('2026-09-10')).toBe('10 Sep 2026'));
  it('date time', () => expect(formatDateTime('2026-09-10T14:05:00.000Z', 'UTC')).toBe('10 Sep 2026, 14:05'));
  it('names', () => { expect(fullName({ firstName: 'Ann', lastName: 'Lee' })).toBe('Ann Lee'); expect(initials({ firstName: 'Ann', lastName: 'Lee' })).toBe('AL'); });
});
```

`src/lib/dates.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { periodBounds, previousPeriod, nextPeriod } from './dates';
describe('dates', () => {
  it('bounds', () => expect(periodBounds('2026-02')).toEqual({ min: '2026-02-01', max: '2026-02-28' }));
  it('prev/next', () => { expect(previousPeriod('2026-01')).toBe('2025-12'); expect(nextPeriod('2026-12')).toBe('2027-01'); });
});
```

- [ ] **Step 5: Run to verify they fail** — `pnpm test` → FAIL (modules missing).

- [ ] **Step 6: Implement**

`src/lib/format.ts`:
```ts
import { format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
export const formatHours = (n: number) => n.toFixed(2);
export const formatPeriod = (p: string) => format(parseISO(`${p}-01`), 'LLLL yyyy');
export const formatDate = (d: string) => format(parseISO(d), 'd MMM yyyy');
export const formatDateTime = (iso: string, tz = Intl.DateTimeFormat().resolvedOptions().timeZone) => formatInTimeZone(parseISO(iso), tz, 'd MMM yyyy, HH:mm');
export const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
export const initials = (p: { firstName: string; lastName: string }) => `${p.firstName[0] ?? ''}${p.lastName[0] ?? ''}`.toUpperCase();
```
(`pnpm add date-fns-tz@^3`.)

`src/lib/dates.ts`:
```ts
import { addMonths, endOfMonth, format, parseISO, subMonths } from 'date-fns';
export const todayIso = () => format(new Date(), 'yyyy-MM-dd');
export const currentPeriod = () => format(new Date(), 'yyyy-MM');
export const previousPeriod = (p: string) => format(subMonths(parseISO(`${p}-01`), 1), 'yyyy-MM');
export const nextPeriod = (p: string) => format(addMonths(parseISO(`${p}-01`), 1), 'yyyy-MM');
export const periodBounds = (p: string) => ({ min: `${p}-01`, max: format(endOfMonth(parseISO(`${p}-01`)), 'yyyy-MM-dd') });
```

`src/app/query.ts`:
```ts
import { QueryClient } from '@tanstack/vue-query';
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false } } });
```

`src/main.ts`:
```ts
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { VueQueryPlugin } from '@tanstack/vue-query';
import App from './App.vue';
import './styles/base.css';
import { queryClient } from './app/query';

const app = createApp(App);
app.use(createPinia());
app.use(VueQueryPlugin, { queryClient });
app.mount('#app');
```
(The router is added in Task 6.)

`src/App.vue`:
```vue
<script setup lang="ts"></script>
<template>
  <div class="min-h-dvh bg-background text-foreground p-6">
    <h1 class="text-2xl font-semibold text-primary">OverTrack</h1>
    <p class="num text-muted-foreground">12.50 h</p>
  </div>
</template>
```

- [ ] **Step 7: Run tests and dev server** — `pnpm test` → PASS (7). `pnpm dev` → page shows the heading in navy, hours in Fira Code; toggle `document.documentElement.classList.add('dark')` in devtools and confirm colors flip.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: scaffold Vue app with Tailwind tokens, base styles and formatting helpers"
```

---

### Task 2: UI components, batch 1 (plain elements)

**Files:**
- Create under `src/components/ui/`: `Button.vue`, `Input.vue`, `Textarea.vue`, `FormField.vue`, `Badge.vue`, `StatusBadge.vue`, `Card.vue`, `StatTile.vue`, `Skeleton.vue`, `EmptyState.vue`, `PageHeader.vue`, `Avatar.vue`, `Spinner.vue`, `index.ts`
- Create: `src/components/ui/Button.spec.ts`, `src/components/ui/StatusBadge.spec.ts`

**Interfaces:**
- `Button` props: `variant: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' = 'primary'`, `size: 'sm' | 'md' = 'md'`, `loading?: boolean`, `type?: 'button' | 'submit'`, `block?: boolean`. Disabled while `loading`; renders `<Spinner>` + slot.
- `Input` props: `modelValue: string | number | null`, `type?`, `invalid?: boolean`, `id?`; emits `update:modelValue`. Passes `$attrs` to the `<input>`.
- `Textarea` same contract.
- `FormField` props: `label: string`, `name: string` (also used as input id), `error?: string`, `hint?: string`, `required?: boolean`. Default slot receives `{ id, invalid }`.
- `Badge` props: `tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'indigo' = 'neutral'`.
- `StatusBadge` props: `status: SheetStatus` → maps draft→neutral+Pencil "Draft", submitted→info+Clock "Submitted", approved→indigo+Check "Approved", paid→success+CheckCircle2 "Paid", rejected→danger+XCircle "Rejected".
- `Card` slots: default, `header`, `footer`; prop `padded = true`.
- `StatTile` props: `label`, `value: string | number`, `hint?`, `tone?`; slot `icon`.
- `Skeleton` props: `class` (size via classes), `lines?: number`.
- `EmptyState` props: `title`, `description?`; slots `icon`, `action`.
- `PageHeader` props: `title`, `description?`; slot `actions`.
- `Avatar` props: `person: { firstName; lastName }`, `size?: 'sm' | 'md'`.
- `Spinner` props: `size?: 'sm' | 'md'`.

- [ ] **Step 1: Write failing tests**

`src/components/ui/Button.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Button from './Button.vue';
describe('Button', () => {
  it('renders slot and primary classes', () => {
    const w = mount(Button, { slots: { default: 'Save' } });
    expect(w.text()).toBe('Save'); expect(w.classes()).toContain('bg-primary'); expect(w.attributes('type')).toBe('button');
  });
  it('disables and shows spinner when loading', () => {
    const w = mount(Button, { props: { loading: true }, slots: { default: 'Save' } });
    expect(w.attributes('disabled')).toBeDefined(); expect(w.find('[data-spinner]').exists()).toBe(true); expect(w.attributes('aria-busy')).toBe('true');
  });
  it('destructive variant', () => expect(mount(Button, { props: { variant: 'destructive' } }).classes()).toContain('bg-destructive'));
});
```

`src/components/ui/StatusBadge.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import StatusBadge from './StatusBadge.vue';
describe('StatusBadge', () => {
  it.each([['draft', 'Draft'], ['submitted', 'Submitted'], ['approved', 'Approved'], ['paid', 'Paid'], ['rejected', 'Rejected']] as const)('%s → %s with an icon', (status, label) => {
    const w = mount(StatusBadge, { props: { status } });
    expect(w.text()).toBe(label); expect(w.find('svg').exists()).toBe(true);
  });
  it('paid uses the accent tone', () => expect(mount(StatusBadge, { props: { status: 'paid' } }).classes().join(' ')).toContain('accent'));
});
```

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement**

`src/components/ui/Spinner.vue`:
```vue
<script setup lang="ts">
defineProps<{ size?: 'sm' | 'md' }>();
</script>
<template>
  <span data-spinner role="status" aria-label="Loading" class="inline-block animate-spin rounded-full border-2 border-current border-t-transparent" :class="size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5'" />
</template>
```

`src/components/ui/Button.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue';
import Spinner from './Spinner.vue';
const props = withDefaults(defineProps<{ variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'; size?: 'sm' | 'md'; loading?: boolean; type?: 'button' | 'submit'; block?: boolean; disabled?: boolean }>(), { variant: 'primary', size: 'md', type: 'button' });
const variants = {
  primary: 'bg-primary text-on-primary hover:brightness-110',
  secondary: 'bg-secondary text-on-secondary hover:brightness-110',
  outline: 'border bg-surface text-foreground hover:bg-muted',
  ghost: 'text-foreground hover:bg-muted',
  destructive: 'bg-destructive text-on-destructive hover:brightness-110',
};
const classes = computed(() => [
  'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors duration-150 cursor-pointer select-none',
  'disabled:opacity-50 disabled:cursor-not-allowed', props.size === 'sm' ? 'h-9 px-3 text-sm' : 'h-11 px-4 text-base', variants[props.variant], props.block ? 'w-full' : '',
]);
</script>
<template>
  <button :type="type" :class="classes" :disabled="disabled || loading" :aria-busy="loading ? 'true' : undefined">
    <Spinner v-if="loading" size="sm" />
    <slot />
  </button>
</template>
```

`src/components/ui/Input.vue`:
```vue
<script setup lang="ts">
defineOptions({ inheritAttrs: false });
defineProps<{ modelValue: string | number | null; type?: string; invalid?: boolean; id?: string; mono?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>
<template>
  <input :id="id" :type="type ?? 'text'" :value="modelValue ?? ''" v-bind="$attrs" :aria-invalid="invalid ? 'true' : undefined"
    class="h-11 w-full rounded-control border bg-surface px-3 text-base text-foreground placeholder:text-muted-foreground transition-colors duration-150 disabled:opacity-50 read-only:bg-muted"
    :class="[invalid ? 'border-destructive' : 'border-border', mono ? 'num' : '']" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
</template>
```

`src/components/ui/Textarea.vue`:
```vue
<script setup lang="ts">
defineOptions({ inheritAttrs: false });
defineProps<{ modelValue: string | null; invalid?: boolean; id?: string; rows?: number }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>
<template>
  <textarea :id="id" :rows="rows ?? 3" :value="modelValue ?? ''" v-bind="$attrs" :aria-invalid="invalid ? 'true' : undefined"
    class="w-full rounded-control border bg-surface px-3 py-2 text-base text-foreground placeholder:text-muted-foreground disabled:opacity-50" :class="invalid ? 'border-destructive' : 'border-border'"
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" />
</template>
```

`src/components/ui/FormField.vue`:
```vue
<script setup lang="ts">
defineProps<{ label: string; name: string; error?: string; hint?: string; required?: boolean }>();
</script>
<template>
  <div class="space-y-1.5">
    <label :for="name" class="block text-sm font-medium text-foreground">{{ label }} <span v-if="required" class="text-destructive" aria-hidden="true">*</span></label>
    <slot :id="name" :invalid="Boolean(error)" />
    <p v-if="error" :id="`${name}-error`" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <p v-else-if="hint" class="text-sm text-muted-foreground">{{ hint }}</p>
  </div>
</template>
```

`src/components/ui/Badge.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue';
const props = withDefaults(defineProps<{ tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'indigo' }>(), { tone: 'neutral' });
const tones = {
  neutral: 'bg-muted text-muted-foreground', info: 'bg-secondary/15 text-secondary', success: 'bg-accent/15 text-accent',
  warning: 'bg-warning/15 text-warning', danger: 'bg-destructive/15 text-destructive', indigo: 'bg-indigo/15 text-indigo',
};
const cls = computed(() => tones[props.tone]);
</script>
<template>
  <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium whitespace-nowrap" :class="cls"><slot /></span>
</template>
```

`src/components/ui/StatusBadge.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue';
import { Pencil, Clock, Check, CheckCircle2, XCircle } from 'lucide-vue-next';
import Badge from './Badge.vue';
import type { SheetStatus } from '@/api/types';
const props = defineProps<{ status: SheetStatus }>();
const map = {
  draft: { tone: 'neutral', label: 'Draft', icon: Pencil }, submitted: { tone: 'info', label: 'Submitted', icon: Clock },
  approved: { tone: 'indigo', label: 'Approved', icon: Check }, paid: { tone: 'success', label: 'Paid', icon: CheckCircle2 }, rejected: { tone: 'danger', label: 'Rejected', icon: XCircle },
} as const;
const m = computed(() => map[props.status]);
</script>
<template>
  <Badge :tone="m.tone" :class="`status-${status}`"><component :is="m.icon" class="h-4 w-4" aria-hidden="true" />{{ m.label }}</Badge>
</template>
```
Create `src/api/types.ts` now with just the status type (the rest is filled in Task 5):
```ts
export type SheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';
```

`src/components/ui/Card.vue`:
```vue
<script setup lang="ts">withDefaults(defineProps<{ padded?: boolean }>(), { padded: true });</script>
<template>
  <section class="rounded-card border bg-surface shadow-card">
    <header v-if="$slots.header" class="border-b px-5 py-4"><slot name="header" /></header>
    <div :class="padded ? 'p-5' : ''"><slot /></div>
    <footer v-if="$slots.footer" class="border-t px-5 py-4"><slot name="footer" /></footer>
  </section>
</template>
```

`src/components/ui/StatTile.vue`:
```vue
<script setup lang="ts">defineProps<{ label: string; value: string | number; hint?: string }>();</script>
<template>
  <div class="rounded-card border bg-surface p-5 shadow-card flex items-start gap-4">
    <div v-if="$slots.icon" class="rounded-control bg-muted p-2 text-primary"><slot name="icon" /></div>
    <div class="min-w-0">
      <p class="text-sm text-muted-foreground">{{ label }}</p>
      <p class="num text-2xl font-semibold leading-tight">{{ value }}</p>
      <p v-if="hint" class="text-sm text-muted-foreground mt-1">{{ hint }}</p>
    </div>
  </div>
</template>
```

`src/components/ui/Skeleton.vue`:
```vue
<script setup lang="ts">withDefaults(defineProps<{ lines?: number }>(), { lines: 1 });</script>
<template>
  <div aria-hidden="true" class="space-y-2">
    <div v-for="i in lines" :key="i" class="h-4 animate-pulse rounded bg-muted" :class="i === lines && lines > 1 ? 'w-2/3' : 'w-full'" />
  </div>
</template>
```

`src/components/ui/EmptyState.vue`:
```vue
<script setup lang="ts">defineProps<{ title: string; description?: string }>();</script>
<template>
  <div class="flex flex-col items-center justify-center gap-3 py-12 text-center">
    <div v-if="$slots.icon" class="text-muted-foreground"><slot name="icon" /></div>
    <p class="font-medium">{{ title }}</p>
    <p v-if="description" class="max-w-sm text-sm text-muted-foreground">{{ description }}</p>
    <div v-if="$slots.action" class="mt-2"><slot name="action" /></div>
  </div>
</template>
```

`src/components/ui/PageHeader.vue`:
```vue
<script setup lang="ts">defineProps<{ title: string; description?: string }>();</script>
<template>
  <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div><h1 class="text-2xl font-semibold">{{ title }}</h1><p v-if="description" class="mt-1 text-muted-foreground">{{ description }}</p></div>
    <div v-if="$slots.actions" class="flex flex-wrap gap-2"><slot name="actions" /></div>
  </div>
</template>
```

`src/components/ui/Avatar.vue`:
```vue
<script setup lang="ts">
import { initials } from '@/lib/format';
defineProps<{ person: { firstName: string; lastName: string }; size?: 'sm' | 'md' }>();
</script>
<template>
  <span class="inline-flex items-center justify-center rounded-full bg-primary/15 font-medium text-primary" :class="size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm'" :aria-label="`${person.firstName} ${person.lastName}`">{{ initials(person) }}</span>
</template>
```

`src/components/ui/index.ts`: re-export every component (`export { default as Button } from './Button.vue';` etc.).

- [ ] **Step 4: Run tests** → PASS (9).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add base UI components (button, inputs, badges, cards, empty and loading states)"
```

---

### Task 3: UI components, batch 2 (Reka UI primitives, toast, pickers, timeline)

**Files:**
- Create under `src/components/ui/`: `Dialog.vue`, `ConfirmDialog.vue`, `Drawer.vue`, `Select.vue`, `Combobox.vue`, `Checkbox.vue`, `Switch.vue`, `DropdownMenu.vue`, `Tabs.vue`, `Toaster.vue`, `useToast.ts`, `DatePicker.vue`, `TimeInput.vue`, `Timeline.vue`
- Create: `src/components/ui/Dialog.spec.ts`, `src/components/ui/useToast.spec.ts`, `src/components/ui/TimeInput.spec.ts`
- Modify: `src/components/ui/index.ts`

**Interfaces:**
- `Dialog` props: `open: boolean`, `title: string`, `description?: string`, `size?: 'sm' | 'md' | 'lg'`; emits `update:open`; slots default, `footer`.
- `ConfirmDialog` props: `open`, `title`, `description?`, `confirmLabel = 'Confirm'`, `destructive?: boolean`, `loading?: boolean`, `requireReason?: boolean`, `reasonLabel = 'Reason'`; emits `update:open`, `confirm: [reason: string]`. Reason input is required (min 5 chars) when `requireReason`.
- `Drawer` props: `open`, `title`, `description?`; emits `update:open`, `beforeClose` (cancelable via `preventDefault` on a passed `Event`); slots default, `footer`. Slides from the right, full-width on mobile, 480px on desktop.
- `Select` props: `modelValue: string | null`, `options: Array<{ value: string; label: string; description?: string }>`, `placeholder?`, `invalid?`, `id?`, `disabled?`; emits `update:modelValue`.
- `Combobox` same props as Select plus `searchable` behavior; filters by label.
- `Checkbox` props: `modelValue: boolean`, `label?`; `Switch` props: `modelValue: boolean`, `label`.
- `DropdownMenu` props: `items: Array<{ label: string; icon?: Component; destructive?: boolean; onSelect: () => void }>`, slot `trigger`.
- `Tabs` props: `modelValue: string`, `tabs: Array<{ value: string; label: string; count?: number }>`; slot per tab value.
- `useToast()` → `{ toast(opts: { title: string; description?: string; tone?: 'success' | 'error' | 'info' }), toasts }`; `Toaster.vue` renders them, auto-dismiss 4000ms, `aria-live="polite"`.
- `DatePicker` props: `modelValue: string | null` (`YYYY-MM-DD`), `min?`, `max?`, `invalid?`, `id?`; native `<input type="date">`.
- `TimeInput` props: `modelValue: string | null` (`HH:mm`), `invalid?`, `id?`; native `<input type="time" step="900">`; normalizes `"9:5"` to `"09:05"`.
- `Timeline` props: `items: Array<{ id: string; title: string; subtitle?: string; at?: string; tone?: 'neutral' | 'info' | 'success' | 'danger' | 'indigo'; icon?: Component }>`.

- [ ] **Step 1: Write failing tests**

`src/components/ui/Dialog.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Dialog from './Dialog.vue';
describe('Dialog', () => {
  it('renders title and content when open', async () => {
    const w = mount(Dialog, { props: { open: true, title: 'Submit sheet' }, slots: { default: '<p>Body</p>' }, attachTo: document.body });
    expect(document.body.textContent).toContain('Submit sheet'); expect(document.body.textContent).toContain('Body');
    w.unmount();
  });
  it('emits update:open false on close button', async () => {
    const w = mount(Dialog, { props: { open: true, title: 'X' }, attachTo: document.body });
    (document.body.querySelector('[data-dialog-close]') as HTMLButtonElement).click();
    expect(w.emitted('update:open')?.[0]).toEqual([false]);
    w.unmount();
  });
});
```

`src/components/ui/useToast.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { useToast } from './useToast';
describe('useToast', () => {
  it('adds and auto-removes after 4s', () => {
    vi.useFakeTimers();
    const { toast, toasts } = useToast();
    toast({ title: 'Saved', tone: 'success' });
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(toasts.value).toHaveLength(0);
    vi.useRealTimers();
  });
});
```

`src/components/ui/TimeInput.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import TimeInput from './TimeInput.vue';
describe('TimeInput', () => {
  it('normalizes to HH:mm and emits', async () => {
    const w = mount(TimeInput, { props: { modelValue: null } });
    await w.find('input').setValue('9:5');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['09:05']);
  });
});
```

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement**

`src/components/ui/Dialog.vue`:
```vue
<script setup lang="ts">
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui';
import { X } from 'lucide-vue-next';
withDefaults(defineProps<{ open: boolean; title: string; description?: string; size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' });
const emit = defineEmits<{ 'update:open': [v: boolean] }>();
const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' };
</script>
<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
      <DialogContent class="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border bg-surface p-6 shadow-dialog focus:outline-none" :class="widths[size]">
        <div class="mb-4 flex items-start justify-between gap-4">
          <div><DialogTitle class="text-lg font-semibold">{{ title }}</DialogTitle><DialogDescription v-if="description" class="mt-1 text-sm text-muted-foreground">{{ description }}</DialogDescription></div>
          <DialogClose data-dialog-close class="rounded-control p-1 text-muted-foreground hover:bg-muted cursor-pointer" aria-label="Close"><X class="h-5 w-5" /></DialogClose>
        </div>
        <slot />
        <div v-if="$slots.footer" class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><slot name="footer" /></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
```

`src/components/ui/ConfirmDialog.vue`:
```vue
<script setup lang="ts">
import { ref, watch } from 'vue';
import Dialog from './Dialog.vue';
import Button from './Button.vue';
import FormField from './FormField.vue';
import Textarea from './Textarea.vue';
const props = withDefaults(defineProps<{ open: boolean; title: string; description?: string; confirmLabel?: string; destructive?: boolean; loading?: boolean; requireReason?: boolean; reasonLabel?: string }>(), { confirmLabel: 'Confirm', reasonLabel: 'Reason' });
const emit = defineEmits<{ 'update:open': [v: boolean]; confirm: [reason: string] }>();
const reason = ref(''); const error = ref('');
watch(() => props.open, (o) => { if (o) { reason.value = ''; error.value = ''; } });
function confirm() {
  if (props.requireReason && reason.value.trim().length < 5) { error.value = 'Please give a reason (at least 5 characters)'; return; }
  emit('confirm', reason.value.trim());
}
</script>
<template>
  <Dialog :open="open" :title="title" :description="description" size="sm" @update:open="emit('update:open', $event)">
    <FormField v-if="requireReason" :label="reasonLabel" name="confirm-reason" :error="error" required>
      <template #default="{ id, invalid }"><Textarea :id="id" v-model="reason" :invalid="invalid" :rows="3" /></template>
    </FormField>
    <template #footer>
      <Button variant="outline" @click="emit('update:open', false)">Cancel</Button>
      <Button :variant="destructive ? 'destructive' : 'primary'" :loading="loading" @click="confirm">{{ confirmLabel }}</Button>
    </template>
  </Dialog>
</template>
```

`src/components/ui/Drawer.vue`:
```vue
<script setup lang="ts">
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui';
import { X } from 'lucide-vue-next';
defineProps<{ open: boolean; title: string; description?: string }>();
const emit = defineEmits<{ 'update:open': [v: boolean]; beforeClose: [e: Event] }>();
function requestClose(next: boolean) {
  if (next) return emit('update:open', true);
  const e = new Event('beforeClose', { cancelable: true });
  emit('beforeClose', e);
  if (!e.defaultPrevented) emit('update:open', false);
}
</script>
<template>
  <DialogRoot :open="open" @update:open="requestClose">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/50" />
      <DialogContent class="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l bg-surface shadow-dialog focus:outline-none" @escape-key-down.prevent="requestClose(false)" @pointer-down-outside.prevent="requestClose(false)">
        <div class="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div><DialogTitle class="text-lg font-semibold">{{ title }}</DialogTitle><DialogDescription v-if="description" class="mt-1 text-sm text-muted-foreground">{{ description }}</DialogDescription></div>
          <DialogClose class="rounded-control p-1 text-muted-foreground hover:bg-muted cursor-pointer" aria-label="Close" @click.prevent="requestClose(false)"><X class="h-5 w-5" /></DialogClose>
        </div>
        <div class="flex-1 overflow-y-auto px-5 py-4"><slot /></div>
        <div v-if="$slots.footer" class="flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end"><slot name="footer" /></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
```

`src/components/ui/Select.vue`:
```vue
<script setup lang="ts">
import { SelectRoot, SelectTrigger, SelectValue, SelectPortal, SelectContent, SelectViewport, SelectItem, SelectItemText, SelectItemIndicator } from 'reka-ui';
import { ChevronDown, Check } from 'lucide-vue-next';
defineProps<{ modelValue: string | null; options: Array<{ value: string; label: string; description?: string }>; placeholder?: string; invalid?: boolean; id?: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [v: string] }>();
</script>
<template>
  <SelectRoot :model-value="modelValue ?? undefined" :disabled="disabled" @update:model-value="emit('update:modelValue', $event as string)">
    <SelectTrigger :id="id" :aria-invalid="invalid ? 'true' : undefined" class="flex h-11 w-full items-center justify-between rounded-control border bg-surface px-3 text-left text-base data-[placeholder]:text-muted-foreground disabled:opacity-50 cursor-pointer" :class="invalid ? 'border-destructive' : 'border-border'">
      <SelectValue :placeholder="placeholder ?? 'Select…'" /><ChevronDown class="h-4 w-4 text-muted-foreground" aria-hidden="true" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent position="popper" :side-offset="4" class="z-50 min-w-[var(--reka-select-trigger-width)] rounded-control border bg-surface p-1 shadow-dialog">
        <SelectViewport>
          <SelectItem v-for="o in options" :key="o.value" :value="o.value" class="relative flex cursor-pointer select-none items-center rounded-control py-2 pl-8 pr-3 text-base outline-none data-[highlighted]:bg-muted">
            <SelectItemIndicator class="absolute left-2"><Check class="h-4 w-4" /></SelectItemIndicator>
            <div><SelectItemText>{{ o.label }}</SelectItemText><p v-if="o.description" class="text-sm text-muted-foreground">{{ o.description }}</p></div>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
```

`src/components/ui/Combobox.vue`:
```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { ComboboxRoot, ComboboxAnchor, ComboboxInput, ComboboxTrigger, ComboboxPortal, ComboboxContent, ComboboxViewport, ComboboxItem, ComboboxEmpty } from 'reka-ui';
import { ChevronDown } from 'lucide-vue-next';
const props = defineProps<{ modelValue: string | null; options: Array<{ value: string; label: string; description?: string }>; placeholder?: string; invalid?: boolean; id?: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [v: string | null] }>();
const term = ref('');
const filtered = computed(() => props.options.filter((o) => o.label.toLowerCase().includes(term.value.toLowerCase())));
const display = (v: string | null) => props.options.find((o) => o.value === v)?.label ?? '';
</script>
<template>
  <ComboboxRoot :model-value="modelValue ?? undefined" :disabled="disabled" :display-value="display" ignore-filter @update:model-value="emit('update:modelValue', ($event as string) ?? null)">
    <ComboboxAnchor class="flex h-11 w-full items-center rounded-control border bg-surface pr-2" :class="invalid ? 'border-destructive' : 'border-border'">
      <ComboboxInput :id="id" :placeholder="placeholder ?? 'Search…'" class="h-full w-full bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground" @input="term = ($event.target as HTMLInputElement).value" />
      <ComboboxTrigger class="p-1 text-muted-foreground cursor-pointer" aria-label="Open options"><ChevronDown class="h-4 w-4" /></ComboboxTrigger>
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent position="popper" :side-offset="4" class="z-50 w-[var(--reka-combobox-trigger-width)] rounded-control border bg-surface p-1 shadow-dialog">
        <ComboboxViewport class="max-h-64">
          <ComboboxEmpty class="px-3 py-2 text-sm text-muted-foreground">No matches</ComboboxEmpty>
          <ComboboxItem v-for="o in filtered" :key="o.value" :value="o.value" class="cursor-pointer rounded-control px-3 py-2 text-base outline-none data-[highlighted]:bg-muted">
            <div>{{ o.label }}<p v-if="o.description" class="text-sm text-muted-foreground">{{ o.description }}</p></div>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
```

`src/components/ui/Checkbox.vue`:
```vue
<script setup lang="ts">
import { CheckboxRoot, CheckboxIndicator } from 'reka-ui';
import { Check } from 'lucide-vue-next';
defineProps<{ modelValue: boolean; label?: string; ariaLabel?: string }>();
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>();
</script>
<template>
  <label class="inline-flex min-h-11 items-center gap-2 cursor-pointer">
    <CheckboxRoot :model-value="modelValue" :aria-label="ariaLabel" class="flex h-5 w-5 items-center justify-center rounded border bg-surface data-[state=checked]:bg-primary data-[state=checked]:text-on-primary" @update:model-value="emit('update:modelValue', $event === true)">
      <CheckboxIndicator><Check class="h-4 w-4" /></CheckboxIndicator>
    </CheckboxRoot>
    <span v-if="label" class="text-base">{{ label }}</span>
  </label>
</template>
```

`src/components/ui/Switch.vue`:
```vue
<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui';
defineProps<{ modelValue: boolean; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>();
</script>
<template>
  <label class="inline-flex min-h-11 items-center gap-3 cursor-pointer">
    <SwitchRoot :model-value="modelValue" class="relative h-6 w-11 rounded-full bg-muted transition-colors data-[state=checked]:bg-accent" @update:model-value="emit('update:modelValue', $event)">
      <SwitchThumb class="block h-5 w-5 translate-x-0.5 rounded-full bg-surface shadow transition-transform data-[state=checked]:translate-x-[22px]" />
    </SwitchRoot>
    <span class="text-base">{{ label }}</span>
  </label>
</template>
```

`src/components/ui/DropdownMenu.vue`:
```vue
<script setup lang="ts">
import type { Component } from 'vue';
import { DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent, DropdownMenuItem } from 'reka-ui';
defineProps<{ items: Array<{ label: string; icon?: Component; destructive?: boolean; onSelect: () => void }> }>();
</script>
<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child><slot name="trigger" /></DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent align="end" :side-offset="4" class="z-50 min-w-44 rounded-control border bg-surface p-1 shadow-dialog">
        <DropdownMenuItem v-for="it in items" :key="it.label" class="flex cursor-pointer items-center gap-2 rounded-control px-3 py-2 text-base outline-none data-[highlighted]:bg-muted" :class="it.destructive ? 'text-destructive' : ''" @select="it.onSelect">
          <component :is="it.icon" v-if="it.icon" class="h-4 w-4" aria-hidden="true" />{{ it.label }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
```

`src/components/ui/Tabs.vue`:
```vue
<script setup lang="ts">
import { TabsRoot, TabsList, TabsTrigger, TabsContent } from 'reka-ui';
defineProps<{ modelValue: string; tabs: Array<{ value: string; label: string; count?: number }> }>();
const emit = defineEmits<{ 'update:modelValue': [v: string] }>();
</script>
<template>
  <TabsRoot :model-value="modelValue" @update:model-value="emit('update:modelValue', $event as string)">
    <TabsList class="mb-4 flex gap-1 overflow-x-auto border-b" aria-label="Tabs">
      <TabsTrigger v-for="t in tabs" :key="t.value" :value="t.value" class="-mb-px flex h-11 items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 text-base text-muted-foreground cursor-pointer data-[state=active]:border-primary data-[state=active]:text-foreground">
        {{ t.label }}<span v-if="t.count !== undefined" class="num rounded-full bg-muted px-2 text-sm">{{ t.count }}</span>
      </TabsTrigger>
    </TabsList>
    <TabsContent v-for="t in tabs" :key="t.value" :value="t.value"><slot :name="t.value" /></TabsContent>
  </TabsRoot>
</template>
```

`src/components/ui/useToast.ts`:
```ts
import { ref } from 'vue';
export interface Toast { id: number; title: string; description?: string; tone: 'success' | 'error' | 'info' }
const toasts = ref<Toast[]>([]);
let seq = 0;
export function useToast() {
  function toast(o: { title: string; description?: string; tone?: Toast['tone'] }) {
    const id = ++seq;
    toasts.value.push({ id, title: o.title, description: o.description, tone: o.tone ?? 'info' });
    setTimeout(() => dismiss(id), 4000);
    return id;
  }
  function dismiss(id: number) { toasts.value = toasts.value.filter((t) => t.id !== id); }
  return { toast, dismiss, toasts };
}
```

`src/components/ui/Toaster.vue`:
```vue
<script setup lang="ts">
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-vue-next';
import { useToast } from './useToast';
const { toasts, dismiss } = useToast();
const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
const tones = { success: 'border-accent/40', error: 'border-destructive/40', info: 'border-secondary/40' };
</script>
<template>
  <div aria-live="polite" class="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
    <div v-for="t in toasts" :key="t.id" class="pointer-events-auto flex items-start gap-3 rounded-card border bg-surface p-4 shadow-dialog" :class="tones[t.tone]">
      <component :is="icons[t.tone]" class="mt-0.5 h-5 w-5 shrink-0" :class="t.tone === 'success' ? 'text-accent' : t.tone === 'error' ? 'text-destructive' : 'text-secondary'" aria-hidden="true" />
      <div class="min-w-0 flex-1"><p class="font-medium">{{ t.title }}</p><p v-if="t.description" class="text-sm text-muted-foreground">{{ t.description }}</p></div>
      <button class="rounded-control p-1 text-muted-foreground hover:bg-muted cursor-pointer" aria-label="Dismiss" @click="dismiss(t.id)"><X class="h-4 w-4" /></button>
    </div>
  </div>
</template>
```

`src/components/ui/DatePicker.vue`:
```vue
<script setup lang="ts">
defineProps<{ modelValue: string | null; min?: string; max?: string; invalid?: boolean; id?: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [v: string | null] }>();
</script>
<template>
  <input :id="id" type="date" :value="modelValue ?? ''" :min="min" :max="max" :disabled="disabled" :aria-invalid="invalid ? 'true' : undefined"
    class="num h-11 w-full rounded-control border bg-surface px-3 text-base disabled:opacity-50" :class="invalid ? 'border-destructive' : 'border-border'"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value || null)" />
</template>
```

`src/components/ui/TimeInput.vue`:
```vue
<script setup lang="ts">
defineProps<{ modelValue: string | null; invalid?: boolean; id?: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [v: string | null] }>();
function normalize(v: string): string | null {
  const m = v.match(/^(\d{1,2}):(\d{1,2})/); if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}`;
}
</script>
<template>
  <input :id="id" type="time" step="900" :value="modelValue ?? ''" :disabled="disabled" :aria-invalid="invalid ? 'true' : undefined"
    class="num h-11 w-full rounded-control border bg-surface px-3 text-base disabled:opacity-50" :class="invalid ? 'border-destructive' : 'border-border'"
    @input="emit('update:modelValue', normalize(($event.target as HTMLInputElement).value))" />
</template>
```

`src/components/ui/Timeline.vue`:
```vue
<script setup lang="ts">
import type { Component } from 'vue';
import { Circle } from 'lucide-vue-next';
defineProps<{ items: Array<{ id: string; title: string; subtitle?: string; at?: string; tone?: 'neutral' | 'info' | 'success' | 'danger' | 'indigo'; icon?: Component }> }>();
const tones = { neutral: 'bg-muted text-muted-foreground', info: 'bg-secondary/15 text-secondary', success: 'bg-accent/15 text-accent', danger: 'bg-destructive/15 text-destructive', indigo: 'bg-indigo/15 text-indigo' };
</script>
<template>
  <ol class="relative space-y-4 border-l pl-6">
    <li v-for="it in items" :key="it.id" class="relative">
      <span class="absolute -left-[31px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full" :class="tones[it.tone ?? 'neutral']"><component :is="it.icon ?? Circle" class="h-3 w-3" aria-hidden="true" /></span>
      <p class="font-medium leading-5">{{ it.title }}</p>
      <p v-if="it.subtitle" class="text-sm text-muted-foreground">{{ it.subtitle }}</p>
      <p v-if="it.at" class="num text-xs text-muted-foreground">{{ it.at }}</p>
    </li>
  </ol>
</template>
```

Export all from `index.ts`. Mount `<Toaster />` in `App.vue` (keep it there permanently).

- [ ] **Step 4: Run tests** → PASS (4 new).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add dialog, drawer, select, combobox, tabs, toast and picker components"
```

---

### Task 4: DataTable and Pagination

**Files:**
- Create: `src/components/ui/DataTable.vue`, `src/components/ui/Pagination.vue`, `src/components/ui/DataTable.spec.ts`
- Modify: `src/components/ui/index.ts`

**Interfaces:**
- `DataTable<T>` props: `columns: ColumnDef<T>[]` (TanStack), `rows: T[]`, `loading?: boolean`, `error?: string | null`, `emptyTitle = 'Nothing here'`, `emptyDescription?`, `rowKey: (r: T) => string`, `sortable?: boolean`, `expandable?: boolean`; emits `retry`, `rowClick: [row: T]`; slots `empty-action`, `expanded` (scope `{ row }`). Renders skeleton rows while loading, `EmptyState` when empty, and an error block with Retry. Numeric cells use `meta: { numeric: true }` to get `num text-right`.
- `Pagination` props: `page`, `pageSize`, `total`; emits `update:page`. Shows "1–20 of 57" and prev/next buttons (44px targets).

- [ ] **Step 1: Write failing test**

`src/components/ui/DataTable.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import type { ColumnDef } from '@tanstack/vue-table';
import DataTable from './DataTable.vue';
type Row = { id: string; name: string; hours: number };
const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }, { accessorKey: 'hours', header: 'Hours', meta: { numeric: true } }];
const rows: Row[] = [{ id: '1', name: 'Bob', hours: 2 }, { id: '2', name: 'Ann', hours: 5 }];
describe('DataTable', () => {
  it('renders rows and sorts on header click', async () => {
    const w = mount(DataTable, { props: { columns, rows, rowKey: (r: Row) => r.id, sortable: true } });
    expect(w.findAll('tbody tr').map((r) => r.text())).toEqual(['Bob2', 'Ann5']);
    await w.find('thead th button').trigger('click');
    expect(w.findAll('tbody tr')[0].text()).toContain('Ann');
    expect(w.find('thead th').attributes('aria-sort')).toBe('ascending');
  });
  it('shows skeleton, empty and error states', async () => {
    const w = mount(DataTable, { props: { columns, rows: [], rowKey: (r: Row) => r.id, loading: true } });
    expect(w.findAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    await w.setProps({ loading: false });
    expect(w.text()).toContain('Nothing here');
    await w.setProps({ error: 'Boom' });
    expect(w.text()).toContain('Boom');
    await w.find('button').trigger('click');
    expect(w.emitted('retry')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`src/components/ui/DataTable.vue`:
```vue
<script setup lang="ts" generic="T">
import { computed, ref } from 'vue';
import { FlexRender, getCoreRowModel, getSortedRowModel, useVueTable, type ColumnDef, type SortingState } from '@tanstack/vue-table';
import { ArrowUpDown, ArrowUp, ArrowDown, AlertCircle, ChevronRight } from 'lucide-vue-next';
import Skeleton from './Skeleton.vue';
import EmptyState from './EmptyState.vue';
import Button from './Button.vue';
const props = withDefaults(defineProps<{ columns: ColumnDef<T, unknown>[]; rows: T[]; rowKey: (r: T) => string; loading?: boolean; error?: string | null; emptyTitle?: string; emptyDescription?: string; sortable?: boolean; expandable?: boolean }>(), { emptyTitle: 'Nothing here', sortable: false });
const emit = defineEmits<{ retry: []; rowClick: [row: T] }>();
const sorting = ref<SortingState>([]);
const expanded = ref<Set<string>>(new Set());
const table = useVueTable({
  get data() { return props.rows; }, get columns() { return props.columns; },
  state: { get sorting() { return sorting.value; } },
  onSortingChange: (u) => { sorting.value = typeof u === 'function' ? u(sorting.value) : u; },
  getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), enableSorting: props.sortable,
  getRowId: (r) => props.rowKey(r),
});
const isNumeric = (meta: unknown) => Boolean((meta as { numeric?: boolean } | undefined)?.numeric);
const ariaSort = (s: false | 'asc' | 'desc') => (s === 'asc' ? 'ascending' : s === 'desc' ? 'descending' : 'none');
const colCount = computed(() => props.columns.length + (props.expandable ? 1 : 0));
function toggle(id: string) { const n = new Set(expanded.value); n.has(id) ? n.delete(id) : n.add(id); expanded.value = n; }
</script>
<template>
  <div class="overflow-x-auto rounded-card border bg-surface shadow-card">
    <table class="w-full min-w-[640px] border-collapse text-base">
      <thead class="bg-muted/60 text-sm text-muted-foreground">
        <tr>
          <th v-if="expandable" class="w-10" />
          <th v-for="h in table.getFlatHeaders()" :key="h.id" scope="col" class="px-4 py-3 text-left font-medium" :class="isNumeric(h.column.columnDef.meta) ? 'text-right' : ''" :aria-sort="sortable && h.column.getCanSort() ? ariaSort(h.column.getIsSorted()) : undefined">
            <button v-if="sortable && h.column.getCanSort()" type="button" class="inline-flex min-h-11 items-center gap-1 cursor-pointer hover:text-foreground" @click="h.column.toggleSorting()">
              <FlexRender :render="h.column.columnDef.header" :props="h.getContext()" />
              <ArrowUp v-if="h.column.getIsSorted() === 'asc'" class="h-4 w-4" /><ArrowDown v-else-if="h.column.getIsSorted() === 'desc'" class="h-4 w-4" /><ArrowUpDown v-else class="h-4 w-4 opacity-50" />
            </button>
            <FlexRender v-else :render="h.column.columnDef.header" :props="h.getContext()" />
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-if="loading">
          <tr v-for="i in 5" :key="i" class="border-t"><td :colspan="colCount" class="px-4 py-3"><Skeleton /></td></tr>
        </template>
        <tr v-else-if="error" class="border-t">
          <td :colspan="colCount" class="px-4 py-8">
            <div class="flex flex-col items-center gap-3 text-center"><AlertCircle class="h-6 w-6 text-destructive" /><p>{{ error }}</p><Button variant="outline" size="sm" @click="emit('retry')">Retry</Button></div>
          </td>
        </tr>
        <tr v-else-if="rows.length === 0" class="border-t">
          <td :colspan="colCount"><EmptyState :title="emptyTitle" :description="emptyDescription"><template #action><slot name="empty-action" /></template></EmptyState></td>
        </tr>
        <template v-else>
          <template v-for="row in table.getRowModel().rows" :key="row.id">
            <tr class="border-t transition-colors hover:bg-muted/40" :class="$attrs.onRowClick ? 'cursor-pointer' : ''" @click="emit('rowClick', row.original)">
              <td v-if="expandable" class="px-2"><button type="button" class="flex h-11 w-8 items-center justify-center cursor-pointer" :aria-expanded="expanded.has(row.id)" aria-label="Toggle details" @click.stop="toggle(row.id)"><ChevronRight class="h-4 w-4 transition-transform" :class="expanded.has(row.id) ? 'rotate-90' : ''" /></button></td>
              <td v-for="cell in row.getVisibleCells()" :key="cell.id" class="px-4 py-3 align-middle" :class="isNumeric(cell.column.columnDef.meta) ? 'num text-right' : ''"><FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" /></td>
            </tr>
            <tr v-if="expandable && expanded.has(row.id)" class="border-t bg-muted/30"><td :colspan="colCount" class="px-4 py-3"><slot name="expanded" :row="row.original" /></td></tr>
          </template>
        </template>
      </tbody>
    </table>
  </div>
</template>
```

`src/components/ui/Pagination.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import Button from './Button.vue';
const props = defineProps<{ page: number; pageSize: number; total: number }>();
const emit = defineEmits<{ 'update:page': [p: number] }>();
const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1));
const to = computed(() => Math.min(props.page * props.pageSize, props.total));
const last = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
</script>
<template>
  <nav class="flex items-center justify-between gap-4 py-3" aria-label="Pagination">
    <p class="num text-sm text-muted-foreground">{{ from }}–{{ to }} of {{ total }}</p>
    <div class="flex gap-2">
      <Button variant="outline" size="sm" :disabled="page <= 1" aria-label="Previous page" @click="emit('update:page', page - 1)"><ChevronLeft class="h-4 w-4" /></Button>
      <Button variant="outline" size="sm" :disabled="page >= last" aria-label="Next page" @click="emit('update:page', page + 1)"><ChevronRight class="h-4 w-4" /></Button>
    </div>
  </nav>
</template>
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add DataTable with sorting, states and expansion, plus Pagination"
```

---

### Task 5: API types, fetch client with refresh, error mapping, auth store

**Files:**
- Create: `src/api/types.ts` (replace the stub), `src/api/errors.ts`, `src/api/client.ts`, `src/api/auth.api.ts`, `src/stores/auth.store.ts`, `src/lib/permissions.ts`
- Create: `src/api/client.spec.ts`, `src/api/errors.spec.ts`, `src/lib/permissions.spec.ts`

**Interfaces:**
- `types.ts` exports (mirroring the API plan): `UserRole`, `SheetStatus`, `StepStatus`, `Paged<T> = { data: T[]; meta: { page; pageSize; total } }`, `PublicUser`, `TeamSummary`, `ChainStepView`, `OvertimeType`, `SheetSummary`, `EntryView`, `StepView`, `SheetDetail`, `InboxRow`, `Notification`, `TeamMonthReport`, `AuditRow`, `ApiErrorBody = { statusCode; code; message; details? }`.
- `errors.ts`: `class ApiError extends Error { status; code; details?: Array<{ path; message }> }`, `messageFor(err: unknown): string`, `fieldErrors(err): Record<string, string>`.
- `client.ts`: `request<T>(method, path, opts?: { body?: unknown; query?: Record<string, string | number | boolean | undefined>; formData?: FormData; raw?: boolean }) → Promise<T>`; `setTokenProvider({ get, refresh, clear })`. On `401` with `TOKEN_EXPIRED`/`UNAUTHORIZED`: calls `refresh()` once (single-flight across concurrent requests), retries once; if refresh fails, calls `clear()` and rethrows. `raw: true` returns the `Response` (for downloads).
- `auth.api.ts`: `login(email, password) → { accessToken, user }`, `refresh() → { accessToken }`, `logout()`, `acceptInvite(token, password)`, `forgotPassword(email)`, `resetPassword(token, password)`, `me()`.
- `auth.store.ts` (`useAuthStore`): state `user: PublicUser | null`, `accessToken: string | null`, `status: 'idle' | 'loading' | 'ready'`; actions `bootstrap()` (tries refresh then `me()`), `login`, `logout`; getters `isAuthenticated`, `role`, `can(perm)`.
- `permissions.ts`: `type Perm = 'admin' | 'finance' | 'manager' | 'approver'`; `hasPerm(user, perm)`; `manager` = roles tech_lead/delivery_manager/cto/finance/admin; `approver` = manager roles (visibility of Inbox is further refined by data: any user may be on a chain, so Inbox is visible to everyone and shows an empty state).

- [ ] **Step 1: Write failing tests**

`src/api/errors.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ApiError, messageFor, fieldErrors } from './errors';
describe('errors', () => {
  it('maps known codes', () => {
    expect(messageFor(new ApiError(409, 'SHEET_VERSION_CONFLICT', 'x'))).toBe('This sheet changed since you loaded it. Reload and try again.');
    expect(messageFor(new ApiError(403, 'NOT_CURRENT_APPROVER', 'x'))).toBe('You are not the approver for this step.');
    expect(messageFor(new Error('zzz'))).toBe('Something went wrong. Please try again.');
  });
  it('extracts field errors', () => {
    const e = new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', [{ path: 'email', message: 'Invalid email' }]);
    expect(fieldErrors(e)).toEqual({ email: 'Invalid email' });
  });
});
```

`src/api/client.spec.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, setTokenProvider } from './client';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
describe('client', () => {
  let token = 'old';
  const refresh = vi.fn(async () => { token = 'new'; return 'new'; });
  const clear = vi.fn();
  beforeEach(() => { token = 'old'; refresh.mockClear(); clear.mockClear(); setTokenProvider({ get: () => token, refresh, clear }); });

  it('sends bearer and unwraps JSON', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(200, { data: { ok: true } }));
    const r = await request<{ data: { ok: boolean } }>('GET', '/me');
    expect(r.data.ok).toBe(true);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer old' });
    fetchMock.mockRestore();
  });

  it('refreshes once on 401 and retries; concurrent requests share one refresh', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      const auth = (init?.headers as Record<string, string>).authorization;
      return auth === 'Bearer new' ? json(200, { data: 1 }) : json(401, { statusCode: 401, code: 'TOKEN_EXPIRED', message: 'x' });
    });
    const [a, b] = await Promise.all([request<{ data: number }>('GET', '/a'), request<{ data: number }>('GET', '/b')]);
    expect(a.data).toBe(1); expect(b.data).toBe(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it('clears the session when refresh fails and throws ApiError', async () => {
    refresh.mockRejectedValueOnce(new Error('nope'));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(401, { statusCode: 401, code: 'TOKEN_EXPIRED', message: 'x' }));
    await expect(request('GET', '/a')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(clear).toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it('throws ApiError with code and details on 400', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(400, { statusCode: 400, code: 'VALIDATION_FAILED', message: 'v', details: [{ path: 'x', message: 'bad' }] }));
    await expect(request('POST', '/a', { body: {} })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'x', message: 'bad' }] });
    fetchMock.mockRestore();
  });
});
```

`src/lib/permissions.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hasPerm } from './permissions';
const u = (role: string) => ({ role } as never);
describe('permissions', () => {
  it('admin', () => { expect(hasPerm(u('admin'), 'admin')).toBe(true); expect(hasPerm(u('finance'), 'admin')).toBe(false); });
  it('finance includes admin', () => { expect(hasPerm(u('admin'), 'finance')).toBe(true); expect(hasPerm(u('employee'), 'finance')).toBe(false); });
  it('manager roles', () => { expect(hasPerm(u('tech_lead'), 'manager')).toBe(true); expect(hasPerm(u('employee'), 'manager')).toBe(false); });
});
```

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement**

`src/api/types.ts`:
```ts
export type UserRole = 'employee' | 'tech_lead' | 'delivery_manager' | 'cto' | 'finance' | 'admin';
export type SheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';
export type StepStatus = 'pending' | 'approved' | 'rejected' | 'skipped';
export interface Paged<T> { data: T[]; meta: { page: number; pageSize: number; total: number } }
export interface Person { id: string; firstName: string; lastName: string }
export interface PublicUser extends Person { email: string; employeeCode: string | null; role: UserRole; teamId: string | null; timezone: string; isActive: boolean; createdAt: string; updatedAt: string }
export interface TeamSummary { id: string; name: string; description: string | null; isActive: boolean; techLead: Person | null; memberCount: number; chainStepCount: number; createdAt: string; updatedAt: string }
export interface ChainPerson extends Person { isActive: boolean }
export interface ChainStepView { id: string; position: number; label: string; approver: ChainPerson; backupApprover: ChainPerson | null }
export interface OvertimeType { id: string; name: string; multiplier: number; color: string; sortOrder: number; isActive: boolean }
export interface SheetEmployee extends Person { employeeCode: string | null; teamId: string | null; teamName: string | null }
export interface SheetSummary {
  id: string; period: string; status: SheetStatus; round: number; currentStepPosition: number | null; totalHours: number; totalWeightedHours: number;
  submittedAt: string | null; approvedAt: string | null; rejectedAt: string | null; rejectionReason: string | null; paidAt: string | null; paymentReference: string | null; version: number; employee: SheetEmployee;
}
export interface EntryView {
  id: string; date: string; startTime: string; endTime: string; hours: number; multiplier: number; weightedHours: number;
  overtimeType: { id: string; name: string; color: string }; workItem: string; workItemUrl: string | null; description: string; requestedBy: Person | null;
  attachment: { id: string; originalName: string; mimeType: string; sizeBytes: number } | null;
}
export interface StepView { position: number; label: string; status: StepStatus; round: number; approver: Person; backupApprover: Person | null; decidedBy: Person | null; decidedAt: string | null; comment: string | null; overrideReason: string | null }
export interface SheetDetail extends SheetSummary { entries: EntryView[]; steps: StepView[] }
export interface InboxRow extends SheetSummary { step: { position: number; label: string; status: StepStatus; decidedAt: string | null } }
export interface AuditRow { id: string; action: string; entityType: string; entityId: string; before: unknown; after: unknown; reason: string | null; createdAt: string; actor: Person | null }
export interface Timeline { sheetId: string; audit: AuditRow[]; rounds: Array<{ round: number; steps: StepView[] }> }
export interface Notification { id: string; type: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }
export interface TeamMonthRow { employee: Person & { employeeCode: string | null }; sheet: SheetSummary | null; hoursByType: Record<string, number>; totalHours: number; totalWeightedHours: number; entries: EntryView[] }
export interface TeamMonthReport { team: { id: string; name: string }; period: string; types: Array<{ id: string; name: string; multiplier: number; color: string }>; rows: TeamMonthRow[]; totals: { totalHours: number; totalWeightedHours: number; hoursByType: Record<string, number> } }
export interface ApiErrorBody { statusCode: number; code: string; message: string; details?: Array<{ path: string; message: string }> }
```

`src/api/errors.ts`:
```ts
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Array<{ path: string; message: string }>) { super(message); this.name = 'ApiError'; }
}
const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Invalid email or password.', USER_INACTIVE: 'This account is inactive. Contact an admin.', TOKEN_EXPIRED: 'Your session expired. Please sign in again.',
  TOKEN_INVALID: 'This link is invalid or was already used.', TOKEN_REUSED: 'Your session was revoked. Please sign in again.', FORBIDDEN: 'You do not have permission to do that.',
  NOT_FOUND: 'Not found.', SHEET_NOT_EDITABLE: 'This sheet is locked and cannot be edited.', SHEET_VERSION_CONFLICT: 'This sheet changed since you loaded it. Reload and try again.',
  SHEET_EMPTY: 'Add at least one entry before submitting.', CHAIN_EMPTY: 'Your team has no approval chain yet. Ask an admin to configure it.',
  CHAIN_APPROVER_INACTIVE: 'An approver on your team chain is inactive. Ask an admin to fix the chain.', NOT_CURRENT_APPROVER: 'You are not the approver for this step.',
  INVALID_TRANSITION: 'That action is not allowed in the sheet’s current state.', ENTRY_OVERLAP: 'This entry overlaps another entry on the same day.',
  ENTRY_OUT_OF_PERIOD: 'The date must be inside the sheet’s month.', ENTRY_IN_FUTURE: 'The date cannot be in the future.', ATTACHMENT_TOO_LARGE: 'The file is larger than 5 MB.',
  ATTACHMENT_TYPE: 'Only PNG, JPEG and PDF files are allowed.', ATTACHMENT_EXISTS: 'This entry already has an attachment.', REASON_REQUIRED: 'A reason is required.',
  PAYMENT_REFERENCE_REQUIRED: 'A payment reference is required.', EMAIL_TAKEN: 'That email is already in use.', EMPLOYEE_CODE_TAKEN: 'That employee code is already in use.',
  TEAM_NAME_TAKEN: 'That team name is already in use.', USER_HAS_NO_TEAM: 'You are not assigned to a team yet. Ask an admin.', RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
};
export function messageFor(err: unknown): string {
  if (err instanceof ApiError) return MESSAGES[err.code] ?? (err.code === 'VALIDATION_FAILED' ? 'Please fix the highlighted fields.' : err.message || 'Something went wrong. Please try again.');
  return 'Something went wrong. Please try again.';
}
export function fieldErrors(err: unknown): Record<string, string> {
  if (err instanceof ApiError && err.code === 'VALIDATION_FAILED' && err.details) return Object.fromEntries(err.details.map((d) => [d.path, d.message]));
  return {};
}
```

`src/api/client.ts`:
```ts
import { ApiError, type ApiErrorBody } from './errors';
import type { ApiErrorBody as Body } from './types';
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

interface TokenProvider { get: () => string | null; refresh: () => Promise<string>; clear: () => void }
let provider: TokenProvider = { get: () => null, refresh: async () => { throw new Error('no provider'); }, clear: () => {} };
export function setTokenProvider(p: TokenProvider) { provider = p; }

let inflightRefresh: Promise<string> | null = null;
function refreshOnce(): Promise<string> {
  if (!inflightRefresh) inflightRefresh = provider.refresh().finally(() => { inflightRefresh = null; });
  return inflightRefresh;
}

export interface RequestOptions { body?: unknown; query?: Record<string, string | number | boolean | undefined>; formData?: FormData; raw?: boolean; skipAuth?: boolean }

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(API_URL + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const run = async (token: string | null) => {
    const headers: Record<string, string> = {};
    if (token && !opts.skipAuth) headers.authorization = `Bearer ${token}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return fetch(url.toString(), { method, headers, credentials: 'include', body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  };
  let res = await run(provider.get());
  if (res.status === 401 && !opts.skipAuth) {
    const body = await safeJson(res);
    if (body?.code === 'TOKEN_EXPIRED' || body?.code === 'UNAUTHORIZED') {
      try { const fresh = await refreshOnce(); res = await run(fresh); }
      catch { provider.clear(); throw new ApiError(401, body.code, body.message); }
    } else { throw new ApiError(401, body?.code ?? 'UNAUTHORIZED', body?.message ?? 'Unauthorized'); }
  }
  if (opts.raw) { if (!res.ok) await throwFrom(res); return res as unknown as T; }
  if (res.status === 204) return undefined as T;
  if (!res.ok) await throwFrom(res);
  return (await res.json()) as T;
}

async function safeJson(res: Response): Promise<Body | null> { try { return (await res.clone().json()) as Body; } catch { return null; } }
async function throwFrom(res: Response): Promise<never> {
  const body = await safeJson(res);
  throw new ApiError(res.status, body?.code ?? 'HTTP_ERROR', body?.message ?? res.statusText, body?.details);
}
export const get = <T>(path: string, query?: RequestOptions['query']) => request<T>('GET', path, { query });
export const post = <T>(path: string, body?: unknown) => request<T>('POST', path, { body });
export const patch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body });
export const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, { body });
export const del = <T>(path: string) => request<T>('DELETE', path);
```
(Remove the duplicate `ApiErrorBody` import; keep the one from `./types` and drop it from `./errors`.)

`src/api/auth.api.ts`:
```ts
import { post, get, request } from './client';
import type { PublicUser } from './types';
export const authApi = {
  login: (email: string, password: string) => request<{ data: { accessToken: string; user: PublicUser } }>('POST', '/auth/login', { body: { email, password }, skipAuth: true }).then((r) => r.data),
  refresh: () => request<{ data: { accessToken: string } }>('POST', '/auth/refresh', { skipAuth: true }).then((r) => r.data.accessToken),
  logout: () => request<void>('POST', '/auth/logout', { skipAuth: true }),
  acceptInvite: (token: string, password: string) => request<void>('POST', '/auth/accept-invite', { body: { token, password }, skipAuth: true }),
  forgotPassword: (email: string) => request<void>('POST', '/auth/forgot-password', { body: { email }, skipAuth: true }),
  resetPassword: (token: string, password: string) => request<void>('POST', '/auth/reset-password', { body: { token, password }, skipAuth: true }),
  me: () => get<{ data: PublicUser }>('/me').then((r) => r.data),
  updateMe: (b: { firstName?: string; lastName?: string; timezone?: string }) => request<{ data: PublicUser }>('PATCH', '/me', { body: b }).then((r) => r.data),
  changePassword: (currentPassword: string, newPassword: string) => post<void>('/me/change-password', { currentPassword, newPassword }),
};
```

`src/lib/permissions.ts`:
```ts
import type { PublicUser, UserRole } from '@/api/types';
export type Perm = 'admin' | 'finance' | 'manager';
const MANAGER: UserRole[] = ['tech_lead', 'delivery_manager', 'cto', 'finance', 'admin'];
export function hasPerm(user: Pick<PublicUser, 'role'> | null, perm: Perm): boolean {
  if (!user) return false;
  if (perm === 'admin') return user.role === 'admin';
  if (perm === 'finance') return user.role === 'finance' || user.role === 'admin';
  return MANAGER.includes(user.role);
}
```

`src/stores/auth.store.ts`:
```ts
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { authApi } from '@/api/auth.api';
import { setTokenProvider } from '@/api/client';
import type { PublicUser } from '@/api/types';
import { hasPerm, type Perm } from '@/lib/permissions';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<PublicUser | null>(null);
  const accessToken = ref<string | null>(null);
  const status = ref<'idle' | 'loading' | 'ready'>('idle');

  function clear() { user.value = null; accessToken.value = null; }
  setTokenProvider({ get: () => accessToken.value, refresh: async () => { const t = await authApi.refresh(); accessToken.value = t; return t; }, clear });

  async function bootstrap() {
    if (status.value !== 'idle') return;
    status.value = 'loading';
    try { accessToken.value = await authApi.refresh(); user.value = await authApi.me(); } catch { clear(); } finally { status.value = 'ready'; }
  }
  async function login(email: string, password: string) {
    const r = await authApi.login(email, password);
    accessToken.value = r.accessToken; user.value = r.user; status.value = 'ready';
  }
  async function logout() { try { await authApi.logout(); } finally { clear(); } }
  const isAuthenticated = computed(() => Boolean(user.value));
  const can = (perm: Perm) => hasPerm(user.value, perm);
  return { user, accessToken, status, bootstrap, login, logout, isAuthenticated, can, setUser: (u: PublicUser) => { user.value = u; } };
});
```

- [ ] **Step 4: Run tests** → PASS (9 new).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add typed API client with single-flight refresh, error mapping and auth store"
```

---

### Task 6: Router, guards, app shell (sidebar, topbar, theme), UI store

**Files:**
- Create: `src/app/router.ts`, `src/app/guards.ts`, `src/app/guards.spec.ts`, `src/stores/ui.store.ts`, `src/components/layout/AppShell.vue`, `Sidebar.vue`, `Topbar.vue`, `UserMenu.vue`, `ThemeToggle.vue`, `src/features/dashboard/DashboardPage.vue` (placeholder replaced in Task 8), `src/features/NotFoundPage.vue`
- Modify: `src/main.ts`, `src/App.vue`

**Interfaces:**
- Routes (name → path → meta): `login /login {public}`, `accept-invite /accept-invite {public}`, `forgot-password /forgot-password {public}`, `reset-password /reset-password {public}`, `dashboard /`, `my-sheets /sheets`, `sheet /sheets/:id`, `inbox /approvals`, `review /approvals/:id`, `team-month /team-month {perm:'manager'}`, `payments /payments {perm:'finance'}`, `admin-users /admin/users {perm:'admin'}`, `admin-teams /admin/teams {perm:'admin'}`, `admin-chain /admin/teams/:id/chain {perm:'admin'}`, `admin-overtime-types /admin/overtime-types {perm:'admin'}`, `admin-audit /admin/audit {perm:'admin'}`, `profile /profile`, `not-found /:pathMatch(.*)*`. All non-public routes are children of `AppShell`.
- `guards.ts`: `resolveNavigation(to: { meta: { public?: boolean; perm?: Perm } ; fullPath }, auth: { isAuthenticated: boolean; user }) → true | { name: 'login', query: { redirect } } | { name: 'dashboard', toast: string }`. Pure function; `router.beforeEach` awaits `auth.bootstrap()` then applies it.
- `ui.store.ts`: `theme: 'light' | 'dark'`, `toggleTheme()`, `sidebarCollapsed`, `toggleSidebar()`, `mobileNavOpen`; persists theme and collapsed state in `localStorage` keys `ot.theme`, `ot.sidebar` (guarded with try/catch).
- `Sidebar` nav items derived from `auth.can(...)` per spec 6.4; active route highlighted (`aria-current="page"`); Inbox shows the unread waiting badge from the notifications store (Task 12 wires it; until then the badge prop defaults to 0).

- [ ] **Step 1: Write failing guard test**

`src/app/guards.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveNavigation } from './guards';
const auth = (role: string | null) => ({ isAuthenticated: role !== null, user: role ? ({ role } as never) : null });
describe('resolveNavigation', () => {
  it('allows public routes', () => expect(resolveNavigation({ meta: { public: true }, fullPath: '/login' }, auth(null))).toBe(true));
  it('redirects anonymous users to login with redirect', () => expect(resolveNavigation({ meta: {}, fullPath: '/sheets/1' }, auth(null))).toEqual({ name: 'login', query: { redirect: '/sheets/1' } }));
  it('sends authenticated users away from login', () => expect(resolveNavigation({ meta: { public: true }, fullPath: '/login' }, auth('employee'))).toEqual({ name: 'dashboard' }));
  it('blocks employees from admin routes with a toast', () => expect(resolveNavigation({ meta: { perm: 'admin' }, fullPath: '/admin/users' }, auth('employee'))).toEqual({ name: 'dashboard', toast: 'You do not have access to that page.' }));
  it('allows admins', () => expect(resolveNavigation({ meta: { perm: 'admin' }, fullPath: '/admin/users' }, auth('admin'))).toBe(true));
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`src/app/guards.ts`:
```ts
import { hasPerm, type Perm } from '@/lib/permissions';
import type { PublicUser } from '@/api/types';
export interface NavTarget { meta: { public?: boolean; perm?: Perm }; fullPath: string }
export type NavResult = true | { name: 'login'; query: { redirect: string } } | { name: 'dashboard'; toast?: string };
export function resolveNavigation(to: NavTarget, auth: { isAuthenticated: boolean; user: PublicUser | null }): NavResult {
  if (to.meta.public) return auth.isAuthenticated ? { name: 'dashboard' } : true;
  if (!auth.isAuthenticated) return { name: 'login', query: { redirect: to.fullPath } };
  if (to.meta.perm && !hasPerm(auth.user, to.meta.perm)) return { name: 'dashboard', toast: 'You do not have access to that page.' };
  return true;
}
```

`src/app/router.ts`:
```ts
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import { useToast } from '@/components/ui/useToast';
import { resolveNavigation } from './guards';
import AppShell from '@/components/layout/AppShell.vue';

const pub = (name: string, path: string, component: () => Promise<unknown>) => ({ name, path, component, meta: { public: true } });
export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (_t, _f, saved) => saved ?? { top: 0 },
  routes: [
    pub('login', '/login', () => import('@/features/auth/LoginPage.vue')),
    pub('accept-invite', '/accept-invite', () => import('@/features/auth/AcceptInvitePage.vue')),
    pub('forgot-password', '/forgot-password', () => import('@/features/auth/ForgotPasswordPage.vue')),
    pub('reset-password', '/reset-password', () => import('@/features/auth/ResetPasswordPage.vue')),
    {
      path: '/', component: AppShell,
      children: [
        { name: 'dashboard', path: '', component: () => import('@/features/dashboard/DashboardPage.vue') },
        { name: 'my-sheets', path: 'sheets', component: () => import('@/features/sheets/MySheetsPage.vue') },
        { name: 'sheet', path: 'sheets/:id', component: () => import('@/features/sheets/SheetPage.vue'), props: true },
        { name: 'inbox', path: 'approvals', component: () => import('@/features/approvals/InboxPage.vue') },
        { name: 'review', path: 'approvals/:id', component: () => import('@/features/approvals/ReviewSheetPage.vue'), props: true },
        { name: 'team-month', path: 'team-month', component: () => import('@/features/reports/TeamMonthPage.vue'), meta: { perm: 'manager' } },
        { name: 'payments', path: 'payments', component: () => import('@/features/payments/PaymentsPage.vue'), meta: { perm: 'finance' } },
        { name: 'admin-users', path: 'admin/users', component: () => import('@/features/admin/UsersPage.vue'), meta: { perm: 'admin' } },
        { name: 'admin-teams', path: 'admin/teams', component: () => import('@/features/admin/TeamsPage.vue'), meta: { perm: 'admin' } },
        { name: 'admin-chain', path: 'admin/teams/:id/chain', component: () => import('@/features/admin/ChainEditorPage.vue'), props: true, meta: { perm: 'admin' } },
        { name: 'admin-overtime-types', path: 'admin/overtime-types', component: () => import('@/features/admin/OvertimeTypesPage.vue'), meta: { perm: 'admin' } },
        { name: 'admin-audit', path: 'admin/audit', component: () => import('@/features/admin/AuditLogPage.vue'), meta: { perm: 'admin' } },
        { name: 'profile', path: 'profile', component: () => import('@/features/profile/ProfilePage.vue') },
        { name: 'not-found', path: ':pathMatch(.*)*', component: () => import('@/features/NotFoundPage.vue') },
      ],
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.bootstrap();
  const r = resolveNavigation({ meta: to.meta as { public?: boolean; perm?: 'admin' | 'finance' | 'manager' }, fullPath: to.fullPath }, { isAuthenticated: auth.isAuthenticated, user: auth.user });
  if (r === true) return true;
  if ('toast' in r && r.toast) useToast().toast({ title: r.toast, tone: 'error' });
  return r;
});
router.afterEach(() => { requestAnimationFrame(() => document.getElementById('main')?.focus()); });
```
Pages referenced here but built in later tasks: create each as a stub `<template><p>{{ name }}</p></template>` now so the build passes; later tasks replace them.

`src/stores/ui.store.ts`:
```ts
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
export const useUiStore = defineStore('ui', () => {
  const theme = ref<'light' | 'dark'>(read('ot.theme') === 'dark' || (read('ot.theme') === null && window.matchMedia?.('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
  const sidebarCollapsed = ref(read('ot.sidebar') === 'collapsed');
  const mobileNavOpen = ref(false);
  watch(theme, (t) => { document.documentElement.classList.toggle('dark', t === 'dark'); write('ot.theme', t); }, { immediate: true });
  watch(sidebarCollapsed, (c) => write('ot.sidebar', c ? 'collapsed' : 'open'));
  return { theme, sidebarCollapsed, mobileNavOpen, toggleTheme: () => { theme.value = theme.value === 'dark' ? 'light' : 'dark'; }, toggleSidebar: () => { sidebarCollapsed.value = !sidebarCollapsed.value; } };
});
```

`src/components/layout/ThemeToggle.vue`:
```vue
<script setup lang="ts">
import { Sun, Moon } from 'lucide-vue-next';
import { useUiStore } from '@/stores/ui.store';
const ui = useUiStore();
</script>
<template>
  <button type="button" class="flex h-11 w-11 items-center justify-center rounded-control text-muted-foreground hover:bg-muted cursor-pointer" :aria-label="ui.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'" @click="ui.toggleTheme()">
    <Sun v-if="ui.theme === 'dark'" class="h-5 w-5" /><Moon v-else class="h-5 w-5" />
  </button>
</template>
```

`src/components/layout/Sidebar.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { LayoutDashboard, FileText, Inbox, Users2, Wallet, UserCog, Network, Timer, ScrollText, ChevronsLeft, ChevronsRight } from 'lucide-vue-next';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
const props = defineProps<{ inboxCount?: number }>();
const auth = useAuthStore(); const ui = useUiStore();
const items = computed(() => [
  { name: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
  { name: 'my-sheets', label: 'My sheets', icon: FileText, show: true },
  { name: 'inbox', label: 'Inbox', icon: Inbox, show: true, badge: props.inboxCount },
  { name: 'team-month', label: 'Team month', icon: Users2, show: auth.can('manager') },
  { name: 'payments', label: 'Payments', icon: Wallet, show: auth.can('finance') },
  { name: 'admin-users', label: 'Users', icon: UserCog, show: auth.can('admin'), group: 'Admin' },
  { name: 'admin-teams', label: 'Teams', icon: Network, show: auth.can('admin'), group: 'Admin' },
  { name: 'admin-overtime-types', label: 'Overtime types', icon: Timer, show: auth.can('admin'), group: 'Admin' },
  { name: 'admin-audit', label: 'Audit log', icon: ScrollText, show: auth.can('admin'), group: 'Admin' },
].filter((i) => i.show));
</script>
<template>
  <nav aria-label="Main" class="flex h-full flex-col gap-1 p-3">
    <template v-for="(it, idx) in items" :key="it.name">
      <p v-if="it.group && items[idx - 1]?.group !== it.group && !ui.sidebarCollapsed" class="mt-4 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ it.group }}</p>
      <RouterLink :to="{ name: it.name }" custom v-slot="{ href, navigate, isActive }">
        <a :href="href" class="flex h-11 items-center gap-3 rounded-control px-3 text-base transition-colors" :class="isActive ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-muted'" :aria-current="isActive ? 'page' : undefined" :title="ui.sidebarCollapsed ? it.label : undefined" @click="navigate(); ui.mobileNavOpen = false">
          <component :is="it.icon" class="h-5 w-5 shrink-0" aria-hidden="true" />
          <span v-if="!ui.sidebarCollapsed" class="flex-1 truncate">{{ it.label }}</span>
          <span v-if="it.badge && !ui.sidebarCollapsed" class="num rounded-full bg-secondary px-2 text-xs text-on-secondary">{{ it.badge }}</span>
        </a>
      </RouterLink>
    </template>
    <button type="button" class="mt-auto hidden h-11 items-center gap-3 rounded-control px-3 text-muted-foreground hover:bg-muted lg:flex cursor-pointer" :aria-label="ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'" @click="ui.toggleSidebar()">
      <ChevronsRight v-if="ui.sidebarCollapsed" class="h-5 w-5" /><ChevronsLeft v-else class="h-5 w-5" /><span v-if="!ui.sidebarCollapsed">Collapse</span>
    </button>
  </nav>
</template>
```

`src/components/layout/UserMenu.vue`:
```vue
<script setup lang="ts">
import { useRouter } from 'vue-router';
import { User, LogOut } from 'lucide-vue-next';
import { useAuthStore } from '@/stores/auth.store';
import { Avatar, DropdownMenu } from '@/components/ui';
const auth = useAuthStore(); const router = useRouter();
const items = [
  { label: 'Profile', icon: User, onSelect: () => router.push({ name: 'profile' }) },
  { label: 'Sign out', icon: LogOut, destructive: true, onSelect: async () => { await auth.logout(); router.push({ name: 'login' }); } },
];
</script>
<template>
  <DropdownMenu :items="items">
    <template #trigger>
      <button type="button" class="flex h-11 items-center gap-2 rounded-control px-2 hover:bg-muted cursor-pointer" aria-label="Account menu">
        <Avatar v-if="auth.user" :person="auth.user" size="sm" /><span class="hidden text-sm sm:inline">{{ auth.user?.firstName }}</span>
      </button>
    </template>
  </DropdownMenu>
</template>
```

`src/components/layout/Topbar.vue`:
```vue
<script setup lang="ts">
import { Menu } from 'lucide-vue-next';
import { useUiStore } from '@/stores/ui.store';
import ThemeToggle from './ThemeToggle.vue';
import UserMenu from './UserMenu.vue';
const ui = useUiStore();
</script>
<template>
  <header class="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-surface/90 px-4 backdrop-blur">
    <button type="button" class="flex h-11 w-11 items-center justify-center rounded-control hover:bg-muted lg:hidden cursor-pointer" aria-label="Open navigation" @click="ui.mobileNavOpen = true"><Menu class="h-5 w-5" /></button>
    <span class="font-semibold text-primary">OverTrack</span>
    <div class="ml-auto flex items-center gap-1"><slot name="right" /><ThemeToggle /><UserMenu /></div>
  </header>
</template>
```

`src/components/layout/AppShell.vue`:
```vue
<script setup lang="ts">
import { RouterView } from 'vue-router';
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from 'reka-ui';
import { useUiStore } from '@/stores/ui.store';
import Sidebar from './Sidebar.vue';
import Topbar from './Topbar.vue';
const ui = useUiStore();
</script>
<template>
  <div class="min-h-dvh lg:flex">
    <a href="#main" class="skip-link">Skip to content</a>
    <aside class="hidden border-r bg-surface lg:block lg:sticky lg:top-0 lg:h-dvh" :class="ui.sidebarCollapsed ? 'w-16' : 'w-60'"><div class="h-14 flex items-center px-4 font-semibold text-primary">{{ ui.sidebarCollapsed ? 'OT' : 'OverTrack' }}</div><Sidebar /></aside>
    <DialogRoot :open="ui.mobileNavOpen" @update:open="ui.mobileNavOpen = $event">
      <DialogPortal><DialogOverlay class="fixed inset-0 z-40 bg-black/50 lg:hidden" />
        <DialogContent class="fixed inset-y-0 left-0 z-50 w-72 bg-surface shadow-dialog lg:hidden"><DialogTitle class="h-14 flex items-center px-4 font-semibold text-primary">OverTrack</DialogTitle><Sidebar /></DialogContent>
      </DialogPortal>
    </DialogRoot>
    <div class="flex min-w-0 flex-1 flex-col">
      <Topbar />
      <main id="main" tabindex="-1" class="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 outline-none sm:px-6"><RouterView /></main>
    </div>
  </div>
</template>
```

`src/features/NotFoundPage.vue`:
```vue
<script setup lang="ts">
import { EmptyState, Button } from '@/components/ui';
</script>
<template>
  <EmptyState title="Page not found" description="The page you are looking for does not exist."><template #action><Button @click="$router.push({ name: 'dashboard' })">Go to dashboard</Button></template></EmptyState>
</template>
```

Modify `src/main.ts`: `import { router } from './app/router'; app.use(router);` after pinia. Modify `src/App.vue` to `<RouterView /><Toaster />`.

- [ ] **Step 4: Run tests and type-check** — `pnpm test` → PASS; `pnpm build` → succeeds with stub pages.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add router with auth and permission guards, app shell, sidebar and theme toggle"
```

---

### Task 7: Auth pages (login, accept invite, forgot, reset)

**Files:**
- Create: `src/features/auth/AuthCard.vue`, `LoginPage.vue`, `AcceptInvitePage.vue`, `ForgotPasswordPage.vue`, `ResetPasswordPage.vue`, `src/features/auth/LoginPage.spec.ts`, `src/components/ui/PasswordInput.vue`

**Interfaces:**
- `PasswordInput` props: `modelValue`, `invalid?`, `id?`, `autocomplete?`; show/hide toggle button with `aria-label`.
- `AuthCard` props: `title`, `description?`; centered card, logo text.
- Forms use vee-validate `useForm` + zod schemas; validation on blur; server `fieldErrors` applied with `setErrors`; generic errors shown in an alert box.
- Login redirects to `route.query.redirect` or dashboard.

- [ ] **Step 1: Write failing test**

`src/features/auth/LoginPage.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import LoginPage from './LoginPage.vue';
const push = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ query: { redirect: '/sheets/9' } }), RouterLink: { template: '<a><slot/></a>' } }));
describe('LoginPage', () => {
  it('validates on submit and logs in then redirects', async () => {
    const pinia = createTestingPinia({ stubActions: true });
    const w = mount(LoginPage, { global: { plugins: [pinia] } });
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.text()).toContain('Enter a valid email');
    await w.find('input[type="email"]').setValue('a@b.co');
    await w.find('input[type="password"]').setValue('Password123!');
    await w.find('form').trigger('submit');
    await flushPromises();
    const { useAuthStore } = await import('@/stores/auth.store');
    expect(useAuthStore().login).toHaveBeenCalledWith('a@b.co', 'Password123!');
    expect(push).toHaveBeenCalledWith('/sheets/9');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`src/components/ui/PasswordInput.vue`:
```vue
<script setup lang="ts">
import { ref } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';
defineProps<{ modelValue: string; invalid?: boolean; id?: string; autocomplete?: string }>();
const emit = defineEmits<{ 'update:modelValue': [v: string] }>();
const show = ref(false);
</script>
<template>
  <div class="relative">
    <input :id="id" :type="show ? 'text' : 'password'" :value="modelValue" :autocomplete="autocomplete ?? 'current-password'" :aria-invalid="invalid ? 'true' : undefined"
      class="h-11 w-full rounded-control border bg-surface pl-3 pr-12 text-base" :class="invalid ? 'border-destructive' : 'border-border'" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
    <button type="button" class="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-control text-muted-foreground hover:bg-muted cursor-pointer" :aria-label="show ? 'Hide password' : 'Show password'" @click="show = !show"><EyeOff v-if="show" class="h-4 w-4" /><Eye v-else class="h-4 w-4" /></button>
  </div>
</template>
```
Add to `index.ts`.

`src/features/auth/AuthCard.vue`:
```vue
<script setup lang="ts">defineProps<{ title: string; description?: string }>();</script>
<template>
  <div class="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
    <div class="w-full max-w-md rounded-card border bg-surface p-6 shadow-card sm:p-8">
      <p class="mb-6 text-center text-lg font-semibold text-primary">OverTrack</p>
      <h1 class="text-xl font-semibold">{{ title }}</h1>
      <p v-if="description" class="mt-1 text-sm text-muted-foreground">{{ description }}</p>
      <div class="mt-6"><slot /></div>
    </div>
  </div>
</template>
```

`src/features/auth/LoginPage.vue`:
```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute, RouterLink } from 'vue-router';
import { useForm } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import { z } from 'zod';
import { useAuthStore } from '@/stores/auth.store';
import { messageFor, fieldErrors } from '@/api/errors';
import { Button, FormField, Input, PasswordInput } from '@/components/ui';
import AuthCard from './AuthCard.vue';
const router = useRouter(); const route = useRoute(); const auth = useAuthStore();
const schema = toTypedSchema(z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') }));
const { handleSubmit, defineField, errors, setErrors, isSubmitting } = useForm({ validationSchema: schema });
const [email] = defineField('email', { validateOnBlur: true, validateOnModelUpdate: false }); const [password] = defineField('password');
const formError = ref('');
const submit = handleSubmit(async (v) => {
  formError.value = '';
  try { await auth.login(v.email, v.password); router.push((route.query.redirect as string) || { name: 'dashboard' }); }
  catch (e) { setErrors(fieldErrors(e)); formError.value = messageFor(e); }
});
</script>
<template>
  <AuthCard title="Sign in" description="Use the email and password your admin gave you.">
    <form class="space-y-4" novalidate @submit.prevent="submit">
      <p v-if="formError" role="alert" class="rounded-control border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{{ formError }}</p>
      <FormField label="Email" name="email" :error="errors.email" required><template #default="{ id, invalid }"><Input :id="id" v-model="email" type="email" autocomplete="email" :invalid="invalid" /></template></FormField>
      <FormField label="Password" name="password" :error="errors.password" required><template #default="{ id, invalid }"><PasswordInput :id="id" v-model="password" :invalid="invalid" /></template></FormField>
      <Button type="submit" block :loading="isSubmitting">Sign in</Button>
      <p class="text-center text-sm"><RouterLink class="text-secondary underline-offset-2 hover:underline" :to="{ name: 'forgot-password' }">Forgot your password?</RouterLink></p>
    </form>
  </AuthCard>
</template>
```

`src/features/auth/ForgotPasswordPage.vue`:
```vue
<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useForm } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import { z } from 'zod';
import { authApi } from '@/api/auth.api';
import { messageFor } from '@/api/errors';
import { Button, FormField, Input } from '@/components/ui';
import AuthCard from './AuthCard.vue';
const { handleSubmit, defineField, errors, isSubmitting } = useForm({ validationSchema: toTypedSchema(z.object({ email: z.string().email('Enter a valid email') })) });
const [email] = defineField('email'); const done = ref(false); const formError = ref('');
const submit = handleSubmit(async (v) => { try { await authApi.forgotPassword(v.email); done.value = true; } catch (e) { formError.value = messageFor(e); } });
</script>
<template>
  <AuthCard title="Reset your password" description="We will email you a link if the address belongs to an account.">
    <p v-if="done" class="rounded-control border border-accent/40 bg-accent/10 px-3 py-2 text-sm">If that email exists, a reset link is on its way. It is valid for one hour.</p>
    <form v-else class="space-y-4" novalidate @submit.prevent="submit">
      <p v-if="formError" role="alert" class="text-sm text-destructive">{{ formError }}</p>
      <FormField label="Email" name="email" :error="errors.email" required><template #default="{ id, invalid }"><Input :id="id" v-model="email" type="email" autocomplete="email" :invalid="invalid" /></template></FormField>
      <Button type="submit" block :loading="isSubmitting">Send reset link</Button>
    </form>
    <p class="mt-4 text-center text-sm"><RouterLink class="text-secondary hover:underline" :to="{ name: 'login' }">Back to sign in</RouterLink></p>
  </AuthCard>
</template>
```

`src/features/auth/SetPasswordForm.vue` (shared by accept-invite and reset):
```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useForm } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import { z } from 'zod';
import { messageFor } from '@/api/errors';
import { Button, FormField, PasswordInput } from '@/components/ui';
const props = defineProps<{ submitLabel: string; action: (password: string) => Promise<void> }>();
const emit = defineEmits<{ done: [] }>();
const schema = toTypedSchema(z.object({ password: z.string().min(10, 'At least 10 characters'), confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' }));
const { handleSubmit, defineField, errors, isSubmitting } = useForm({ validationSchema: schema });
const [password] = defineField('password'); const [confirm] = defineField('confirm'); const formError = ref('');
const submit = handleSubmit(async (v) => { formError.value = ''; try { await props.action(v.password); emit('done'); } catch (e) { formError.value = messageFor(e); } });
</script>
<template>
  <form class="space-y-4" novalidate @submit.prevent="submit">
    <p v-if="formError" role="alert" class="text-sm text-destructive">{{ formError }}</p>
    <FormField label="New password" name="password" :error="errors.password" hint="At least 10 characters" required><template #default="{ id, invalid }"><PasswordInput :id="id" v-model="password" autocomplete="new-password" :invalid="invalid" /></template></FormField>
    <FormField label="Confirm password" name="confirm" :error="errors.confirm" required><template #default="{ id, invalid }"><PasswordInput :id="id" v-model="confirm" autocomplete="new-password" :invalid="invalid" /></template></FormField>
    <Button type="submit" block :loading="isSubmitting">{{ submitLabel }}</Button>
  </form>
</template>
```

`src/features/auth/AcceptInvitePage.vue`:
```vue
<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { authApi } from '@/api/auth.api';
import { useToast } from '@/components/ui/useToast';
import AuthCard from './AuthCard.vue';
import SetPasswordForm from './SetPasswordForm.vue';
const route = useRoute(); const router = useRouter(); const { toast } = useToast();
const token = String(route.query.token ?? '');
</script>
<template>
  <AuthCard title="Welcome to OverTrack" description="Set a password to activate your account.">
    <p v-if="!token" class="text-sm text-destructive">This invite link is missing its token. Ask your admin to resend the invite.</p>
    <SetPasswordForm v-else submit-label="Activate account" :action="(p) => authApi.acceptInvite(token, p)" @done="toast({ title: 'Account activated. Sign in to continue.', tone: 'success' }); router.push({ name: 'login' })" />
  </AuthCard>
</template>
```

`src/features/auth/ResetPasswordPage.vue`: identical to AcceptInvitePage with title "Choose a new password", `authApi.resetPassword(token, p)`, toast "Password updated. Sign in to continue.".

- [ ] **Step 4: Run tests** → PASS. `pnpm dev` with the API running: sign in as `admin@overtrack.local`, confirm redirect to dashboard stub; wrong password shows the mapped message.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add login, invite acceptance, forgot and reset password pages"
```

---

### Task 8: Dashboard page

**Files:**
- Create: `src/api/sheets.api.ts`, `src/api/inbox.api.ts`, `src/features/dashboard/DashboardPage.vue` (replace stub), `src/features/dashboard/DashboardPage.spec.ts`

**Interfaces:**
- `sheetsApi`: `list(q: { employeeId?; teamId?; period?; status?; page?; pageSize? }) → Paged<SheetSummary>`, `forPeriod(period) → SheetSummary`, `get(id) → SheetDetail`, `addEntry(sheetId, body: EntryInput) → EntryView`, `updateEntry(sheetId, entryId, body: Partial<EntryInput>) → EntryView`, `deleteEntry(sheetId, entryId)`, `uploadAttachment(sheetId, entryId, file: File) → EntryView['attachment']`, `deleteAttachment(sheetId, entryId)`, `attachmentUrl(id)` (returns `${API_URL}/attachments/${id}`; the page fetches it with the client in `raw` mode and opens a blob URL, see Task 9). `EntryInput = { date; startTime; endTime; hours?; overtimeTypeId; workItem; workItemUrl?: string | null; description; requestedById?: string | null }`.
- `inboxApi.list(scope, page?, pageSize?) → Paged<InboxRow>`.
- Dashboard tiles: employee: current month hours, weighted hours, status; approver (anyone): waiting count with link to Inbox; finance/admin: approved-unpaid count (from `sheetsApi.list({ status: 'approved', pageSize: 1 }).meta.total`). "Recent activity" list uses the notifications API from Task 12; until then it shows the last 5 of `sheetsApi.list({ pageSize: 5 })` for the current user ("My recent sheets").

- [ ] **Step 1: Implement API modules**

`src/api/sheets.api.ts`:
```ts
import { get, post, patch, del, request, API_URL } from './client';
import type { Paged, SheetSummary, SheetDetail, EntryView } from './types';
export interface EntryInput { date: string; startTime: string; endTime: string; hours?: number; overtimeTypeId: string; workItem: string; workItemUrl?: string | null; description: string; requestedById?: string | null }
export const sheetsApi = {
  list: (q: { employeeId?: string; teamId?: string; period?: string; status?: string; page?: number; pageSize?: number } = {}) => get<Paged<SheetSummary>>('/sheets', q),
  forPeriod: (period: string) => post<{ data: SheetSummary }>('/sheets/for-period', { period }).then((r) => r.data),
  get: (id: string) => get<{ data: SheetDetail }>(`/sheets/${id}`).then((r) => r.data),
  addEntry: (sheetId: string, body: EntryInput) => post<{ data: EntryView }>(`/sheets/${sheetId}/entries`, body).then((r) => r.data),
  updateEntry: (sheetId: string, entryId: string, body: Partial<EntryInput>) => patch<{ data: EntryView }>(`/sheets/${sheetId}/entries/${entryId}`, body).then((r) => r.data),
  deleteEntry: (sheetId: string, entryId: string) => del<void>(`/sheets/${sheetId}/entries/${entryId}`),
  uploadAttachment: (sheetId: string, entryId: string, file: File) => { const fd = new FormData(); fd.append('file', file); return request<{ data: NonNullable<EntryView['attachment']> }>('POST', `/sheets/${sheetId}/entries/${entryId}/attachment`, { formData: fd }).then((r) => r.data); },
  deleteAttachment: (sheetId: string, entryId: string) => del<void>(`/sheets/${sheetId}/entries/${entryId}/attachment`),
  openAttachment: async (id: string) => { const res = await request<Response>('GET', `/attachments/${id}`, { raw: true }); const url = URL.createObjectURL(await res.blob()); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60_000); },
  attachmentUrl: (id: string) => `${API_URL}/attachments/${id}`,
};
```

`src/api/inbox.api.ts`:
```ts
import { get } from './client';
import type { Paged, InboxRow } from './types';
export type InboxScope = 'waiting' | 'upcoming' | 'decided';
export const inboxApi = { list: (scope: InboxScope, page = 1, pageSize = 20) => get<Paged<InboxRow>>('/approvals/inbox', { scope, page, pageSize }) };
```

- [ ] **Step 2: Write failing test**

`src/features/dashboard/DashboardPage.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import DashboardPage from './DashboardPage.vue';
vi.mock('vue-router', () => ({ RouterLink: { template: '<a><slot/></a>' }, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/api/sheets.api', () => ({ sheetsApi: { forPeriod: vi.fn(async () => ({ id: 's', period: '2026-10', status: 'draft', totalHours: 3.5, totalWeightedHours: 5.25, version: 1 })), list: vi.fn(async () => ({ data: [], meta: { page: 1, pageSize: 1, total: 2 } })) } }));
vi.mock('@/api/inbox.api', () => ({ inboxApi: { list: vi.fn(async () => ({ data: [], meta: { page: 1, pageSize: 1, total: 4 } })) } }));
describe('DashboardPage', () => {
  it('shows month tiles and the waiting count', async () => {
    const pinia = createTestingPinia({ initialState: { auth: { user: { id: 'u', role: 'finance', firstName: 'Fay', lastName: 'F' } } } });
    const w = mount(DashboardPage, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] } });
    await flushPromises(); await flushPromises();
    expect(w.text()).toContain('3.50'); expect(w.text()).toContain('5.25'); expect(w.text()).toContain('4'); expect(w.text()).toContain('Ready for payment');
  });
});
```
Note: `createTestingPinia` stubs actions but getters/functions returned from setup stores (`can`) remain; `auth.can('finance')` uses `hasPerm(user)` so the initial state drives it.

- [ ] **Step 3: Run to verify it fails** → FAIL.

- [ ] **Step 4: Implement**

`src/features/dashboard/DashboardPage.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import { Clock, Scale, Inbox, Wallet, FileText } from 'lucide-vue-next';
import { useAuthStore } from '@/stores/auth.store';
import { sheetsApi } from '@/api/sheets.api';
import { inboxApi } from '@/api/inbox.api';
import { currentPeriod } from '@/lib/dates';
import { formatHours, formatPeriod } from '@/lib/format';
import { PageHeader, StatTile, StatusBadge, Card, Skeleton, Button } from '@/components/ui';
const auth = useAuthStore(); const period = currentPeriod();
const month = useQuery({ queryKey: ['sheets', 'for-period', period], queryFn: () => sheetsApi.forPeriod(period) });
const waiting = useQuery({ queryKey: ['inbox', 'waiting', 'count'], queryFn: () => inboxApi.list('waiting', 1, 1) });
const unpaid = useQuery({ queryKey: ['sheets', 'approved-count'], queryFn: () => sheetsApi.list({ status: 'approved', pageSize: 1 }), enabled: computed(() => auth.can('finance')) });
const recent = useQuery({ queryKey: ['sheets', 'mine', 'recent'], queryFn: () => sheetsApi.list({ employeeId: auth.user?.id, pageSize: 5 }) });
</script>
<template>
  <PageHeader :title="`Hello, ${auth.user?.firstName ?? ''}`" :description="formatPeriod(period)">
    <template #actions><Button @click="$router.push(month.data.value ? { name: 'sheet', params: { id: month.data.value.id } } : { name: 'my-sheets' })">Add overtime</Button></template>
  </PageHeader>
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <template v-if="month.isPending.value"><Skeleton v-for="i in 2" :key="i" :lines="2" /></template>
    <template v-else-if="month.data.value">
      <StatTile label="This month" :value="`${formatHours(month.data.value.totalHours)} h`" hint="Overtime hours"><template #icon><Clock class="h-5 w-5" /></template></StatTile>
      <StatTile label="Weighted" :value="`${formatHours(month.data.value.totalWeightedHours)} h`" hint="After multipliers"><template #icon><Scale class="h-5 w-5" /></template></StatTile>
      <RouterLink :to="{ name: 'sheet', params: { id: month.data.value.id } }" class="rounded-card border bg-surface p-5 shadow-card hover:bg-muted/40"><p class="text-sm text-muted-foreground">Sheet status</p><div class="mt-2"><StatusBadge :status="month.data.value.status" /></div></RouterLink>
    </template>
    <RouterLink :to="{ name: 'inbox' }"><StatTile label="Waiting for you" :value="waiting.data.value?.meta.total ?? '–'" hint="Approvals"><template #icon><Inbox class="h-5 w-5" /></template></StatTile></RouterLink>
    <RouterLink v-if="auth.can('finance')" :to="{ name: 'payments' }"><StatTile label="Ready for payment" :value="unpaid.data.value?.meta.total ?? '–'" hint="Approved, unpaid"><template #icon><Wallet class="h-5 w-5" /></template></StatTile></RouterLink>
  </div>
  <Card class="mt-6"><template #header><h2 class="font-semibold">My recent sheets</h2></template>
    <Skeleton v-if="recent.isPending.value" :lines="3" />
    <p v-else-if="!recent.data.value?.data.length" class="text-sm text-muted-foreground">No sheets yet. Add your first overtime entry.</p>
    <ul v-else class="divide-y">
      <li v-for="s in recent.data.value.data" :key="s.id"><RouterLink :to="{ name: 'sheet', params: { id: s.id } }" class="flex min-h-11 items-center justify-between gap-3 py-2 hover:text-primary"><span class="flex items-center gap-2"><FileText class="h-4 w-4 text-muted-foreground" />{{ formatPeriod(s.period) }}</span><span class="flex items-center gap-3"><span class="num text-sm">{{ formatHours(s.totalHours) }} h</span><StatusBadge :status="s.status" /></span></RouterLink></li>
    </ul>
  </Card>
</template>
```

- [ ] **Step 5: Run tests** → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add role-aware dashboard with month, inbox and payment tiles"
```

---

### Task 9: My sheets page, Sheet page, entries table and entry form with attachments

**Files:**
- Create: `src/api/overtime-types.api.ts`, `src/api/users.api.ts`, `src/features/sheets/entry.schema.ts`, `entry.schema.spec.ts`, `MySheetsPage.vue`, `SheetPage.vue`, `components/EntriesTable.vue`, `components/SheetTotals.vue`, `components/EntryForm.vue`, `components/EntryForm.spec.ts`, `src/features/sheets/useSheet.ts`

**Interfaces:**
- `overtimeTypesApi.list(includeInactive?) → OvertimeType[]`, `create`, `update`.
- `usersApi.list(q) → Paged<PublicUser>`, `create`, `update`, `deactivate`, `reactivate`, `resendInvite`, `get(id)`.
- `entrySchema(period: string, today: string)` → zod schema: `date` required, within `periodBounds(period)`, `<= today`; `startTime`/`endTime` `HH:mm`, end after start; `hours` optional number 0.25..16 in quarter steps; `overtimeTypeId` uuid; `workItem` 1..120; `workItemUrl` url or empty; `description` 10..1000; `requestedById` optional. `deriveHours(start, end)` → number rounded to quarter.
- `useSheet(id)` → `{ sheet: UseQueryResult<SheetDetail>, invalidate() }` with query key `['sheet', id]`.
- `EntryForm` props: `sheetId`, `period`, `entry?: EntryView | null` (edit mode), `open`; emits `update:open`, `saved: [EntryView]`. Includes attachment upload/remove in edit mode (the entry must exist first; in create mode a hint says "Save the entry, then add an attachment").
- `EntriesTable` props: `entries: EntryView[]`, `editable: boolean`, `loading?`; emits `edit: [EntryView]`, `remove: [EntryView]`, `openAttachment: [id]`.
- `SheetTotals` props: `sheet: SheetSummary`.
- Routes: `/sheets` lists the current user's sheets newest first with status and totals and a "Current month" button that calls `forPeriod(currentPeriod())` then navigates. `/sheets/:id` shows the detail; the actions bar and timeline are added in Task 10.

- [ ] **Step 1: Write failing tests**

`src/features/sheets/entry.schema.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { entrySchema, deriveHours } from './entry.schema';
const base = { date: '2026-09-10', startTime: '18:00', endTime: '20:30', overtimeTypeId: '11111111-1111-4111-8111-111111111111', workItem: 'PROJ-1', workItemUrl: '', description: 'Hotfix for payments', requestedById: null };
const s = entrySchema('2026-09', '2026-09-20');
describe('entrySchema', () => {
  it('accepts a valid entry and derives hours', () => { expect(s.safeParse(base).success).toBe(true); expect(deriveHours('18:00', '20:30')).toBe(2.5); });
  it('rejects empty date, out-of-period and future dates', () => {
    expect(s.safeParse({ ...base, date: '' }).success).toBe(false);
    expect(s.safeParse({ ...base, date: '2026-10-01' }).error?.issues[0].path).toEqual(['date']);
    expect(s.safeParse({ ...base, date: '2026-09-25' }).error?.issues[0].message).toMatch(/future/);
  });
  it('rejects end before start and bad quarter steps', () => {
    expect(s.safeParse({ ...base, endTime: '17:00' }).error?.issues[0].path).toEqual(['endTime']);
    expect(s.safeParse({ ...base, hours: 1.3 }).success).toBe(false);
  });
  it('treats empty url as null', () => { expect(s.parse(base).workItemUrl).toBeNull(); });
});
```

`src/features/sheets/components/EntryForm.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import EntryForm from './EntryForm.vue';
vi.mock('@/api/overtime-types.api', () => ({ overtimeTypesApi: { list: vi.fn(async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Weekday', multiplier: 1.5, color: '#000', sortOrder: 1, isActive: true }]) } }));
vi.mock('@/api/users.api', () => ({ usersApi: { list: vi.fn(async () => ({ data: [], meta: { page: 1, pageSize: 100, total: 0 } })) } }));
vi.mock('@/api/sheets.api', () => ({ sheetsApi: { addEntry: vi.fn(async (_s: string, b: unknown) => ({ id: 'e1', ...(b as object) })) } }));
describe('EntryForm', () => {
  it('shows field errors on empty submit and does not call the API', async () => {
    const w = mount(EntryForm, { props: { open: true, sheetId: 's1', period: '2026-09' }, global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] }, attachTo: document.body });
    await flushPromises();
    (document.body.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();
    const { sheetsApi } = await import('@/api/sheets.api');
    expect(sheetsApi.addEntry).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Pick a date');
    w.unmount();
  });
});
```

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement API modules and schema**

`src/api/overtime-types.api.ts`:
```ts
import { get, post, patch } from './client';
import type { OvertimeType } from './types';
export const overtimeTypesApi = {
  list: (includeInactive = false) => get<{ data: OvertimeType[] }>('/overtime-types', { includeInactive: includeInactive ? 'true' : undefined }).then((r) => r.data),
  create: (b: { name: string; multiplier: number; color?: string; sortOrder?: number }) => post<{ data: OvertimeType }>('/overtime-types', b).then((r) => r.data),
  update: (id: string, b: Partial<{ name: string; multiplier: number; color: string; sortOrder: number; isActive: boolean }>) => patch<{ data: OvertimeType }>(`/overtime-types/${id}`, b).then((r) => r.data),
};
```

`src/api/users.api.ts`:
```ts
import { get, post, patch } from './client';
import type { Paged, PublicUser, UserRole } from './types';
export interface UserInput { firstName: string; lastName: string; email: string; role: UserRole; teamId?: string | null; employeeCode?: string | null; timezone?: string }
export const usersApi = {
  list: (q: { search?: string; role?: string; teamId?: string; isActive?: 'true' | 'false'; page?: number; pageSize?: number } = {}) => get<Paged<PublicUser>>('/users', q),
  get: (id: string) => get<{ data: PublicUser }>(`/users/${id}`).then((r) => r.data),
  create: (b: UserInput) => post<{ data: PublicUser }>('/users', b).then((r) => r.data),
  update: (id: string, b: Partial<Omit<UserInput, 'email'>>) => patch<{ data: PublicUser }>(`/users/${id}`, b).then((r) => r.data),
  deactivate: (id: string) => post<{ data: PublicUser }>(`/users/${id}/deactivate`).then((r) => r.data),
  reactivate: (id: string) => post<{ data: PublicUser }>(`/users/${id}/reactivate`).then((r) => r.data),
  resendInvite: (id: string) => post<void>(`/users/${id}/resend-invite`),
};
```

`src/features/sheets/entry.schema.ts`:
```ts
import { z } from 'zod';
import { periodBounds } from '@/lib/dates';
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const deriveHours = (start: string, end: string) => Math.round(((toMin(end) - toMin(start)) / 60) * 4) / 4;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a time');
export function entrySchema(period: string, today: string) {
  const { min, max } = periodBounds(period);
  return z.object({
    date: z.string().min(1, 'Pick a date').refine((d) => d >= min && d <= max, `Date must be inside ${period}`).refine((d) => d <= today, 'Date cannot be in the future'),
    startTime: time, endTime: time,
    hours: z.number().min(0.25).max(16).refine((n) => Math.abs(n * 4 - Math.round(n * 4)) < 1e-9, 'Use 0.25 steps').optional(),
    overtimeTypeId: z.string().uuid('Pick an overtime type'),
    workItem: z.string().trim().min(1, 'Enter a work item').max(120),
    workItemUrl: z.string().trim().url('Enter a valid URL').or(z.literal('')).transform((v) => (v === '' ? null : v)),
    description: z.string().trim().min(10, 'Describe the work (at least 10 characters)').max(1000),
    requestedById: z.string().uuid().nullable().optional(),
  }).refine((v) => deriveHours(v.startTime, v.endTime) > 0, { path: ['endTime'], message: 'End time must be after start time' });
}
export type EntryFormValues = z.input<ReturnType<typeof entrySchema>>;
```

- [ ] **Step 4: Implement composable and components**

`src/features/sheets/useSheet.ts`:
```ts
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { sheetsApi } from '@/api/sheets.api';
export function useSheet(id: string) {
  const qc = useQueryClient();
  const sheet = useQuery({ queryKey: ['sheet', id], queryFn: () => sheetsApi.get(id) });
  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: ['sheet', id] }), qc.invalidateQueries({ queryKey: ['sheets'] }), qc.invalidateQueries({ queryKey: ['timeline', id] })]);
  return { sheet, invalidate };
}
```

`src/features/sheets/components/SheetTotals.vue`:
```vue
<script setup lang="ts">
import type { SheetSummary } from '@/api/types';
import { formatHours } from '@/lib/format';
defineProps<{ sheet: SheetSummary }>();
</script>
<template>
  <dl class="grid grid-cols-2 gap-4 rounded-card border bg-surface p-4 shadow-card sm:grid-cols-4">
    <div><dt class="text-sm text-muted-foreground">Total hours</dt><dd class="num text-xl font-semibold">{{ formatHours(sheet.totalHours) }}</dd></div>
    <div><dt class="text-sm text-muted-foreground">Weighted hours</dt><dd class="num text-xl font-semibold">{{ formatHours(sheet.totalWeightedHours) }}</dd></div>
    <div><dt class="text-sm text-muted-foreground">Round</dt><dd class="num text-xl font-semibold">{{ sheet.round }}</dd></div>
    <div><dt class="text-sm text-muted-foreground">Payment</dt><dd class="num text-base">{{ sheet.paymentReference ?? '—' }}</dd></div>
  </dl>
</template>
```

`src/features/sheets/components/EntriesTable.vue`:
```vue
<script setup lang="ts">
import { h } from 'vue';
import type { ColumnDef } from '@tanstack/vue-table';
import { Paperclip, Pencil, Trash2, ExternalLink } from 'lucide-vue-next';
import type { EntryView } from '@/api/types';
import { formatDate, formatHours } from '@/lib/format';
import { DataTable, Badge, Button } from '@/components/ui';
const props = defineProps<{ entries: EntryView[]; editable: boolean; loading?: boolean }>();
const emit = defineEmits<{ edit: [e: EntryView]; remove: [e: EntryView]; openAttachment: [id: string] }>();
const columns: ColumnDef<EntryView, unknown>[] = [
  { accessorKey: 'date', header: 'Date', cell: ({ row }) => h('span', { class: 'num' }, formatDate(row.original.date)) },
  { id: 'time', header: 'Time', cell: ({ row }) => h('span', { class: 'num' }, `${row.original.startTime}–${row.original.endTime}`) },
  { accessorKey: 'hours', header: 'Hours', meta: { numeric: true }, cell: ({ row }) => formatHours(row.original.hours) },
  { id: 'type', header: 'Type', cell: ({ row }) => h(Badge, { tone: 'info' }, () => `${row.original.overtimeType.name} ×${row.original.multiplier}`) },
  { accessorKey: 'weightedHours', header: 'Weighted', meta: { numeric: true }, cell: ({ row }) => formatHours(row.original.weightedHours) },
  { id: 'work', header: 'Work item', cell: ({ row }) => row.original.workItemUrl ? h('a', { href: row.original.workItemUrl, target: '_blank', rel: 'noopener', class: 'inline-flex items-center gap-1 text-secondary hover:underline' }, [row.original.workItem, h(ExternalLink, { class: 'h-3.5 w-3.5' })]) : row.original.workItem },
  { accessorKey: 'description', header: 'Description', cell: ({ row }) => h('span', { class: 'block max-w-[28ch] truncate', title: row.original.description }, row.original.description) },
  { id: 'attachment', header: '', cell: ({ row }) => row.original.attachment ? h('button', { type: 'button', class: 'flex h-11 w-11 items-center justify-center rounded-control hover:bg-muted cursor-pointer', 'aria-label': `Open ${row.original.attachment.originalName}`, onClick: (e: Event) => { e.stopPropagation(); emit('openAttachment', row.original.attachment!.id); } }, [h(Paperclip, { class: 'h-4 w-4' })]) : null },
  { id: 'actions', header: '', cell: ({ row }) => props.editable ? h('div', { class: 'flex justify-end gap-1' }, [
      h(Button, { variant: 'ghost', size: 'sm', 'aria-label': 'Edit entry', onClick: (e: Event) => { e.stopPropagation(); emit('edit', row.original); } }, () => h(Pencil, { class: 'h-4 w-4' })),
      h(Button, { variant: 'ghost', size: 'sm', 'aria-label': 'Delete entry', onClick: (e: Event) => { e.stopPropagation(); emit('remove', row.original); } }, () => h(Trash2, { class: 'h-4 w-4 text-destructive' })),
    ]) : null },
];
</script>
<template>
  <DataTable :columns="columns" :rows="entries" :row-key="(e) => e.id" :loading="loading" empty-title="No entries yet" :empty-description="editable ? 'Add your first overtime entry for this month.' : undefined"><template #empty-action><slot name="empty-action" /></template></DataTable>
</template>
```

`src/features/sheets/components/EntryForm.vue`:
```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useForm } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import { useQuery } from '@tanstack/vue-query';
import { Paperclip, Trash2 } from 'lucide-vue-next';
import type { EntryView } from '@/api/types';
import { sheetsApi } from '@/api/sheets.api';
import { overtimeTypesApi } from '@/api/overtime-types.api';
import { usersApi } from '@/api/users.api';
import { messageFor, fieldErrors } from '@/api/errors';
import { periodBounds, todayIso } from '@/lib/dates';
import { fullName } from '@/lib/format';
import { useToast } from '@/components/ui/useToast';
import { Drawer, Button, FormField, Input, Textarea, Select, Combobox, DatePicker, TimeInput } from '@/components/ui';
import { entrySchema, deriveHours } from '../entry.schema';

const props = defineProps<{ open: boolean; sheetId: string; period: string; entry?: EntryView | null }>();
const emit = defineEmits<{ 'update:open': [v: boolean]; saved: [e: EntryView] }>();
const { toast } = useToast();
const types = useQuery({ queryKey: ['overtime-types'], queryFn: () => overtimeTypesApi.list() });
const people = useQuery({ queryKey: ['users', 'pickers'], queryFn: () => usersApi.list({ isActive: 'true', pageSize: 100 }) });
const typeOptions = computed(() => (types.data.value ?? []).map((t) => ({ value: t.id, label: t.name, description: `×${t.multiplier.toFixed(2)}` })));
const peopleOptions = computed(() => (people.data.value?.data ?? []).map((u) => ({ value: u.id, label: fullName(u) })));
const bounds = computed(() => periodBounds(props.period));

const { handleSubmit, defineField, errors, setErrors, resetForm, isSubmitting, meta, values } = useForm({ validationSchema: toTypedSchema(entrySchema(props.period, todayIso())), initialValues: { date: '', startTime: '', endTime: '', overtimeTypeId: '', workItem: '', workItemUrl: '', description: '', requestedById: null } });
const [date] = defineField('date'); const [startTime] = defineField('startTime'); const [endTime] = defineField('endTime'); const [hours] = defineField('hours');
const [overtimeTypeId] = defineField('overtimeTypeId'); const [workItem] = defineField('workItem'); const [workItemUrl] = defineField('workItemUrl'); const [description] = defineField('description'); const [requestedById] = defineField('requestedById');
const formError = ref(''); const hoursTouched = ref(false);
watch([startTime, endTime], ([s, e]) => { if (!hoursTouched.value && s && e) { const d = deriveHours(s, e); if (d > 0) hours.value = d; } });
watch(() => props.open, (o) => {
  if (!o) return; formError.value = ''; hoursTouched.value = false;
  const e = props.entry;
  resetForm({ values: e ? { date: e.date, startTime: e.startTime, endTime: e.endTime, hours: e.hours, overtimeTypeId: e.overtimeType.id, workItem: e.workItem, workItemUrl: e.workItemUrl ?? '', description: e.description, requestedById: e.requestedBy?.id ?? null } : { date: '', startTime: '', endTime: '', overtimeTypeId: '', workItem: '', workItemUrl: '', description: '', requestedById: null } });
}, { immediate: true });

const submit = handleSubmit(async (v) => {
  formError.value = '';
  try {
    const saved = props.entry ? await sheetsApi.updateEntry(props.sheetId, props.entry.id, v) : await sheetsApi.addEntry(props.sheetId, v);
    toast({ title: props.entry ? 'Entry updated' : 'Entry added', tone: 'success' });
    emit('saved', saved);
  } catch (e) { setErrors(fieldErrors(e)); formError.value = messageFor(e); }
});
function beforeClose(e: Event) { if (meta.value.dirty && !confirm('Discard unsaved changes?')) e.preventDefault(); }

const uploading = ref(false); const fileInput = ref<HTMLInputElement | null>(null);
async function upload(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]; if (!file || !props.entry) return;
  if (file.size > 5 * 1024 * 1024) { toast({ title: 'File is larger than 5 MB', tone: 'error' }); return; }
  uploading.value = true;
  try { const att = await sheetsApi.uploadAttachment(props.sheetId, props.entry.id, file); emit('saved', { ...props.entry, attachment: att }); toast({ title: 'Attachment added', tone: 'success' }); }
  catch (e) { toast({ title: messageFor(e), tone: 'error' }); } finally { uploading.value = false; if (fileInput.value) fileInput.value.value = ''; }
}
async function removeAttachment() {
  if (!props.entry?.attachment) return;
  try { await sheetsApi.deleteAttachment(props.sheetId, props.entry.id); emit('saved', { ...props.entry, attachment: null }); } catch (e) { toast({ title: messageFor(e), tone: 'error' }); }
}
</script>
<template>
  <Drawer :open="open" :title="entry ? 'Edit entry' : 'Add overtime entry'" :description="`Period ${period}`" @update:open="emit('update:open', $event)" @before-close="beforeClose">
    <form id="entry-form" class="space-y-4" novalidate @submit.prevent="submit">
      <p v-if="formError" role="alert" class="rounded-control border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{{ formError }}</p>
      <FormField label="Date" name="date" :error="errors.date" required><template #default="{ id, invalid }"><DatePicker :id="id" v-model="date" :min="bounds.min" :max="bounds.max" :invalid="invalid" /></template></FormField>
      <div class="grid grid-cols-2 gap-3">
        <FormField label="Start" name="startTime" :error="errors.startTime" required><template #default="{ id, invalid }"><TimeInput :id="id" v-model="startTime" :invalid="invalid" /></template></FormField>
        <FormField label="End" name="endTime" :error="errors.endTime" required><template #default="{ id, invalid }"><TimeInput :id="id" v-model="endTime" :invalid="invalid" /></template></FormField>
      </div>
      <FormField label="Hours" name="hours" :error="errors.hours" hint="Auto-filled from the times, in 0.25 steps" required><template #default="{ id, invalid }"><Input :id="id" :model-value="hours ?? ''" type="number" step="0.25" min="0.25" max="16" mono :invalid="invalid" @update:model-value="hoursTouched = true; hours = $event === '' ? undefined : Number($event)" /></template></FormField>
      <FormField label="Overtime type" name="overtimeTypeId" :error="errors.overtimeTypeId" required><template #default="{ id, invalid }"><Select :id="id" v-model="overtimeTypeId" :options="typeOptions" placeholder="Pick a type" :invalid="invalid" /></template></FormField>
      <FormField label="Work item" name="workItem" :error="errors.workItem" hint="Ticket key or short reference" required><template #default="{ id, invalid }"><Input :id="id" v-model="workItem" placeholder="PROJ-123" :invalid="invalid" /></template></FormField>
      <FormField label="Work item URL" name="workItemUrl" :error="errors.workItemUrl"><template #default="{ id, invalid }"><Input :id="id" v-model="workItemUrl" type="url" placeholder="https://" :invalid="invalid" /></template></FormField>
      <FormField label="What did you do?" name="description" :error="errors.description" required><template #default="{ id, invalid }"><Textarea :id="id" v-model="description" :rows="4" :invalid="invalid" /></template></FormField>
      <FormField label="Requested by" name="requestedById" :error="errors.requestedById" hint="Optional: the manager who asked for this overtime"><template #default="{ id, invalid }"><Combobox :id="id" v-model="requestedById" :options="peopleOptions" placeholder="Search people" :invalid="invalid" /></template></FormField>
      <div class="rounded-card border p-3">
        <p class="text-sm font-medium">Attachment</p>
        <template v-if="entry">
          <div v-if="entry.attachment" class="mt-2 flex items-center justify-between gap-2 text-sm"><span class="flex items-center gap-2 truncate"><Paperclip class="h-4 w-4" />{{ entry.attachment.originalName }}</span><Button variant="ghost" size="sm" aria-label="Remove attachment" @click="removeAttachment"><Trash2 class="h-4 w-4 text-destructive" /></Button></div>
          <div v-else class="mt-2"><input ref="fileInput" type="file" accept="image/png,image/jpeg,application/pdf" class="block text-sm" :disabled="uploading" @change="upload" /><p class="mt-1 text-xs text-muted-foreground">PNG, JPEG or PDF, max 5 MB</p></div>
        </template>
        <p v-else class="mt-1 text-sm text-muted-foreground">Save the entry first, then add an attachment.</p>
      </div>
    </form>
    <template #footer>
      <Button variant="outline" @click="emit('update:open', false)">Cancel</Button>
      <Button type="submit" form="entry-form" :loading="isSubmitting">{{ entry ? 'Save changes' : 'Add entry' }}</Button>
    </template>
  </Drawer>
</template>
```

`src/features/sheets/MySheetsPage.vue`:
```vue
<script setup lang="ts">
import { h, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import type { ColumnDef } from '@tanstack/vue-table';
import { sheetsApi } from '@/api/sheets.api';
import { useAuthStore } from '@/stores/auth.store';
import type { SheetSummary } from '@/api/types';
import { currentPeriod } from '@/lib/dates';
import { formatHours, formatPeriod, formatDateTime } from '@/lib/format';
import { messageFor } from '@/api/errors';
import { PageHeader, Button, DataTable, Pagination, StatusBadge } from '@/components/ui';
const router = useRouter(); const auth = useAuthStore(); const page = ref(1);
const q = useQuery({ queryKey: ['sheets', 'mine', page], queryFn: () => sheetsApi.list({ employeeId: auth.user?.id, page: page.value }) });
const opening = ref(false);
async function openCurrent() { opening.value = true; try { const s = await sheetsApi.forPeriod(currentPeriod()); router.push({ name: 'sheet', params: { id: s.id } }); } finally { opening.value = false; } }
const columns: ColumnDef<SheetSummary, unknown>[] = [
  { accessorKey: 'period', header: 'Month', cell: ({ row }) => formatPeriod(row.original.period) },
  { accessorKey: 'totalHours', header: 'Hours', meta: { numeric: true }, cell: ({ row }) => formatHours(row.original.totalHours) },
  { accessorKey: 'totalWeightedHours', header: 'Weighted', meta: { numeric: true }, cell: ({ row }) => formatHours(row.original.totalWeightedHours) },
  { accessorKey: 'status', header: 'Status', cell: ({ row }) => h(StatusBadge, { status: row.original.status }) },
  { accessorKey: 'submittedAt', header: 'Submitted', cell: ({ row }) => h('span', { class: 'num' }, row.original.submittedAt ? formatDateTime(row.original.submittedAt) : '—') },
];
</script>
<template>
  <PageHeader title="My sheets" description="One sheet per month. Submit when the month is complete."><template #actions><Button :loading="opening" @click="openCurrent">Current month</Button></template></PageHeader>
  <DataTable :columns="columns" :rows="q.data.value?.data ?? []" :row-key="(s) => s.id" :loading="q.isPending.value" :error="q.isError.value ? messageFor(q.error.value) : null" empty-title="No sheets yet" empty-description="Open the current month to add your first entry." @retry="q.refetch()" @row-click="router.push({ name: 'sheet', params: { id: $event.id } })"><template #empty-action><Button @click="openCurrent">Open current month</Button></template></DataTable>
  <Pagination v-if="q.data.value" :page="page" :page-size="q.data.value.meta.pageSize" :total="q.data.value.meta.total" @update:page="page = $event" />
</template>
```

`src/features/sheets/SheetPage.vue` (actions and timeline added in Task 10):
```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { Plus } from 'lucide-vue-next';
import type { EntryView } from '@/api/types';
import { sheetsApi } from '@/api/sheets.api';
import { useAuthStore } from '@/stores/auth.store';
import { formatPeriod, fullName } from '@/lib/format';
import { messageFor } from '@/api/errors';
import { useToast } from '@/components/ui/useToast';
import { PageHeader, Button, StatusBadge, Skeleton, ConfirmDialog, EmptyState } from '@/components/ui';
import { useSheet } from './useSheet';
import SheetTotals from './components/SheetTotals.vue';
import EntriesTable from './components/EntriesTable.vue';
import EntryForm from './components/EntryForm.vue';
const props = defineProps<{ id: string }>();
const auth = useAuthStore(); const { toast } = useToast();
const { sheet, invalidate } = useSheet(props.id);
const isOwner = computed(() => sheet.data.value?.employee.id === auth.user?.id);
const editable = computed(() => isOwner.value && (sheet.data.value?.status === 'draft' || sheet.data.value?.status === 'rejected'));
const formOpen = ref(false); const editing = ref<EntryView | null>(null); const removing = ref<EntryView | null>(null); const removeLoading = ref(false);
function add() { editing.value = null; formOpen.value = true; }
function edit(e: EntryView) { editing.value = e; formOpen.value = true; }
async function saved(e: EntryView) { editing.value = e; await invalidate(); if (!e.attachment && !editing.value) formOpen.value = false; }
async function confirmRemove() {
  if (!removing.value) return; removeLoading.value = true;
  try { await sheetsApi.deleteEntry(props.id, removing.value.id); toast({ title: 'Entry deleted', tone: 'success' }); removing.value = null; await invalidate(); }
  catch (e) { toast({ title: messageFor(e), tone: 'error' }); } finally { removeLoading.value = false; }
}
</script>
<template>
  <Skeleton v-if="sheet.isPending.value" :lines="4" />
  <EmptyState v-else-if="sheet.isError.value" title="Could not load this sheet" :description="messageFor(sheet.error.value)"><template #action><Button variant="outline" @click="sheet.refetch()">Retry</Button></template></EmptyState>
  <template v-else-if="sheet.data.value">
    <PageHeader :title="formatPeriod(sheet.data.value.period)" :description="isOwner ? 'Your overtime sheet' : `${fullName(sheet.data.value.employee)} · ${sheet.data.value.employee.teamName ?? 'No team'}`">
      <template #actions><StatusBadge :status="sheet.data.value.status" /><Button v-if="editable" @click="add"><Plus class="h-4 w-4" />Add entry</Button></template>
    </PageHeader>
    <div class="space-y-6">
      <SheetTotals :sheet="sheet.data.value" />
      <EntriesTable :entries="sheet.data.value.entries" :editable="editable" @edit="edit" @remove="removing = $event" @open-attachment="sheetsApi.openAttachment($event)"><template #empty-action><Button v-if="editable" @click="add">Add entry</Button></template></EntriesTable>
      <div id="sheet-actions" />
    </div>
    <EntryForm v-model:open="formOpen" :sheet-id="id" :period="sheet.data.value.period" :entry="editing" @saved="saved" />
    <ConfirmDialog :open="Boolean(removing)" title="Delete this entry?" :description="removing ? `${removing.date} ${removing.startTime}–${removing.endTime}, ${removing.workItem}` : ''" confirm-label="Delete" destructive :loading="removeLoading" @update:open="(v) => !v && (removing = null)" @confirm="confirmRemove" />
  </template>
</template>
```
Simplify `saved`: after a create, keep the drawer open in edit mode so the user can attach a file (`editing.value = e` already does this); after an update, keep it open too. The user closes with Cancel. Remove the conditional `formOpen.value = false` line.

- [ ] **Step 5: Run tests** → PASS. Manual: with the seeded API, open `/sheets`, open the current month, add an entry with an overlap and see `ENTRY_OVERLAP` mapped; attach a PNG; open it.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add my sheets list, sheet page, entries table and entry form with attachments"
```

---

### Task 10: Sheet actions (submit, withdraw), rejection banner, approval timeline

**Files:**
- Create: `src/api/workflow.api.ts`, `src/features/sheets/components/SheetActions.vue`, `SheetActions.spec.ts`, `RejectionBanner.vue`, `ApprovalTimeline.vue`, `src/features/sheets/useSheetAction.ts`
- Modify: `src/features/sheets/SheetPage.vue`

**Interfaces:**
- `workflowApi`: `submit(id, version)`, `withdraw(id, version)`, `approve(id, version, comment?, overrideReason?)`, `reject(id, version, reason, overrideReason?)`, `reopen(id, version, reason)`, `markPaid(id, version, paymentReference, paidAt?)`, `revertPaid(id, version, reason)`, `markPaidBulk(items, paymentReference)`, `timeline(id) → Timeline`. All single-sheet actions return `SheetSummary`.
- `useSheetAction(id, invalidate)` → `{ run(action: () => Promise<unknown>, successTitle): Promise<boolean>, pending }`. On `SHEET_VERSION_CONFLICT` it toasts the mapped message with tone error, refetches, and returns false. On success toasts and invalidates.
- `SheetActions` props: `sheet: SheetDetail`, `isOwner`; shows: Submit (draft/rejected + owner) with a ConfirmDialog listing the chain labels from `sheet.steps` when present or "Your team's approval chain"; Withdraw (submitted + owner + no approved step in `sheet.steps`); emits nothing, uses `useSheetAction` directly. Admin-only Reopen (approved) lives here too (ConfirmDialog with reason).
- `RejectionBanner` props: `reason: string`, `rejectedAt: string | null`; slot `action`.
- `ApprovalTimeline` props: `timeline: Timeline` → renders one `Timeline` per round (latest first) with steps as items: skipped (neutral, "Skipped: self"), pending (info), approved (success, "by X" + comment + "override: reason"), rejected (danger). Plus audit rows (paid, reverted, reopened, withdrawn) appended to the latest round list.

- [ ] **Step 1: Write failing test**

`src/features/sheets/components/SheetActions.spec.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import SheetActions from './SheetActions.vue';
import { ApiError } from '@/api/errors';
const submit = vi.fn();
vi.mock('@/api/workflow.api', () => ({ workflowApi: { submit: (...a: unknown[]) => submit(...a), withdraw: vi.fn(), reopen: vi.fn() } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const base = { id: 's1', version: 3, status: 'draft', steps: [], entries: [{ id: 'e' }], employee: { id: 'me' } } as never;
const mountIt = (sheet: unknown, role = 'employee') => mount(SheetActions, { props: { sheet: sheet as never, isOwner: true, role: role as never, invalidate: vi.fn(async () => {}) }, global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] }, attachTo: document.body });
beforeEach(() => submit.mockReset());
describe('SheetActions', () => {
  it('shows Submit for a draft and sends the version after confirm', async () => {
    const w = mountIt(base);
    await w.find('[data-action="submit"]').trigger('click');
    (document.body.querySelector('[data-confirm]') as HTMLButtonElement).click();
    await flushPromises();
    expect(submit).toHaveBeenCalledWith('s1', 3);
    w.unmount();
  });
  it('shows no Submit on a paid sheet', () => { const w = mountIt({ ...base, status: 'paid' }); expect(w.find('[data-action="submit"]').exists()).toBe(false); w.unmount(); });
  it('on version conflict, toasts and calls invalidate; button stops spinning', async () => {
    submit.mockRejectedValueOnce(new ApiError(409, 'SHEET_VERSION_CONFLICT', 'x'));
    const w = mountIt(base);
    await w.find('[data-action="submit"]').trigger('click');
    (document.body.querySelector('[data-confirm]') as HTMLButtonElement).click();
    await flushPromises();
    expect((w.props('invalidate') as () => void)).toHaveBeenCalled();
    expect(w.find('[data-action="submit"]').attributes('aria-busy')).toBeUndefined();
    const { useToast } = await import('@/components/ui/useToast');
    expect(useToast().toasts.value.at(-1)?.title).toContain('changed since you loaded it');
    w.unmount();
  });
});
```
Note: `ConfirmDialog`'s confirm button must carry `data-confirm` (add the attribute to the `Button` in `ConfirmDialog.vue`).

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`src/api/workflow.api.ts`:
```ts
import { get, post } from './client';
import type { SheetSummary, Timeline } from './types';
const act = (id: string, action: string, body: Record<string, unknown>) => post<{ data: SheetSummary }>(`/sheets/${id}/${action}`, body).then((r) => r.data);
export const workflowApi = {
  submit: (id: string, version: number) => act(id, 'submit', { version }),
  withdraw: (id: string, version: number) => act(id, 'withdraw', { version }),
  approve: (id: string, version: number, comment?: string, overrideReason?: string) => act(id, 'approve', { version, comment, overrideReason }),
  reject: (id: string, version: number, reason: string, overrideReason?: string) => act(id, 'reject', { version, reason, overrideReason }),
  reopen: (id: string, version: number, reason: string) => act(id, 'reopen', { version, reason }),
  markPaid: (id: string, version: number, paymentReference: string, paidAt?: string) => act(id, 'mark-paid', { version, paymentReference, paidAt }),
  revertPaid: (id: string, version: number, reason: string) => act(id, 'revert-paid', { version, reason }),
  markPaidBulk: (sheets: Array<{ id: string; version: number }>, paymentReference: string) => post<{ data: { paid: string[]; failed: Array<{ id: string; code: string }> } }>('/sheets/mark-paid', { sheets, paymentReference }).then((r) => r.data),
  timeline: (id: string) => get<{ data: Timeline }>(`/sheets/${id}/timeline`).then((r) => r.data),
};
```

`src/features/sheets/useSheetAction.ts`:
```ts
import { ref } from 'vue';
import { ApiError, messageFor } from '@/api/errors';
import { useToast } from '@/components/ui/useToast';
export function useSheetAction(invalidate: () => Promise<unknown>) {
  const { toast } = useToast(); const pending = ref(false);
  async function run(action: () => Promise<unknown>, successTitle: string): Promise<boolean> {
    pending.value = true;
    try { await action(); toast({ title: successTitle, tone: 'success' }); await invalidate(); return true; }
    catch (e) {
      toast({ title: messageFor(e), tone: 'error' });
      if (e instanceof ApiError && e.code === 'SHEET_VERSION_CONFLICT') await invalidate();
      return false;
    } finally { pending.value = false; }
  }
  return { run, pending };
}
```

`src/features/sheets/components/SheetActions.vue`:
```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { Send, Undo2, RotateCcw } from 'lucide-vue-next';
import type { SheetDetail, UserRole } from '@/api/types';
import { workflowApi } from '@/api/workflow.api';
import { Button, ConfirmDialog } from '@/components/ui';
import { useSheetAction } from '../useSheetAction';
const props = defineProps<{ sheet: SheetDetail; isOwner: boolean; role: UserRole; invalidate: () => Promise<unknown> }>();
const { run, pending } = useSheetAction(props.invalidate);
const canSubmit = computed(() => props.isOwner && (props.sheet.status === 'draft' || props.sheet.status === 'rejected'));
const canWithdraw = computed(() => props.isOwner && props.sheet.status === 'submitted' && !props.sheet.steps.some((s) => s.status === 'approved'));
const canReopen = computed(() => props.role === 'admin' && props.sheet.status === 'approved');
const dialog = ref<null | 'submit' | 'withdraw' | 'reopen'>(null);
const chainText = computed(() => props.sheet.steps.length ? `Approval chain: ${props.sheet.steps.map((s) => s.label).join(' → ')}.` : 'It will go through your team’s approval chain.');
async function go(reason: string) {
  const s = props.sheet; const d = dialog.value; dialog.value = null;
  if (d === 'submit') await run(() => workflowApi.submit(s.id, s.version), 'Sheet submitted');
  if (d === 'withdraw') await run(() => workflowApi.withdraw(s.id, s.version), 'Sheet withdrawn');
  if (d === 'reopen') await run(() => workflowApi.reopen(s.id, s.version, reason), 'Sheet reopened');
}
</script>
<template>
  <div v-if="canSubmit || canWithdraw || canReopen" class="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
    <p v-if="canSubmit && sheet.entries.length === 0" class="mr-auto text-sm text-muted-foreground">Add at least one entry to submit.</p>
    <Button v-if="canWithdraw" variant="outline" data-action="withdraw" :loading="pending" @click="dialog = 'withdraw'"><Undo2 class="h-4 w-4" />Withdraw</Button>
    <Button v-if="canReopen" variant="outline" data-action="reopen" :loading="pending" @click="dialog = 'reopen'"><RotateCcw class="h-4 w-4" />Reopen</Button>
    <Button v-if="canSubmit" data-action="submit" :loading="pending" :disabled="sheet.entries.length === 0" @click="dialog = 'submit'"><Send class="h-4 w-4" />{{ sheet.status === 'rejected' ? 'Resubmit' : 'Submit for approval' }}</Button>
    <ConfirmDialog :open="dialog === 'submit'" title="Submit this sheet?" :description="`Entries lock after submission. ${chainText}`" confirm-label="Submit" @update:open="(v) => !v && (dialog = null)" @confirm="go" />
    <ConfirmDialog :open="dialog === 'withdraw'" title="Withdraw this sheet?" description="It returns to draft so you can edit it. Approvers will be notified." confirm-label="Withdraw" @update:open="(v) => !v && (dialog = null)" @confirm="go" />
    <ConfirmDialog :open="dialog === 'reopen'" title="Reopen this approved sheet?" description="The employee can edit it again and must resubmit through the whole chain." confirm-label="Reopen" destructive require-reason @update:open="(v) => !v && (dialog = null)" @confirm="go" />
  </div>
</template>
```
In `ConfirmDialog.vue`, add `data-confirm` to the confirm `Button`.

`src/features/sheets/components/RejectionBanner.vue`:
```vue
<script setup lang="ts">
import { XCircle } from 'lucide-vue-next';
import { formatDateTime } from '@/lib/format';
defineProps<{ reason: string; rejectedAt: string | null }>();
</script>
<template>
  <div role="alert" class="flex items-start gap-3 rounded-card border border-destructive/40 bg-destructive/10 p-4">
    <XCircle class="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
    <div class="min-w-0 flex-1"><p class="font-medium text-destructive">This sheet was rejected<span v-if="rejectedAt" class="num font-normal text-muted-foreground"> · {{ formatDateTime(rejectedAt) }}</span></p><p class="mt-1 text-sm">{{ reason }}</p><p class="mt-1 text-sm text-muted-foreground">Fix the entries and resubmit. Approval starts again from the first step.</p></div>
    <slot name="action" />
  </div>
</template>
```

`src/features/sheets/components/ApprovalTimeline.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue';
import { Check, X, Clock, SkipForward, Wallet, RotateCcw, Undo2, Send } from 'lucide-vue-next';
import type { Timeline as TimelineT, StepView, AuditRow } from '@/api/types';
import { formatDateTime, fullName } from '@/lib/format';
import { Timeline, Card } from '@/components/ui';
const props = defineProps<{ timeline: TimelineT }>();
function stepItem(s: StepView) {
  const who = s.decidedBy ? ` by ${fullName(s.decidedBy)}` : ''; const approver = fullName(s.approver) + (s.backupApprover ? ` (backup ${fullName(s.backupApprover)})` : '');
  const override = s.overrideReason ? ` · admin override: ${s.overrideReason}` : '';
  const map = {
    pending: { tone: 'info' as const, icon: Clock, title: `${s.label}: waiting for ${approver}` },
    approved: { tone: 'success' as const, icon: Check, title: `${s.label}: approved${who}${s.comment ? ` — “${s.comment}”` : ''}${override}` },
    rejected: { tone: 'danger' as const, icon: X, title: `${s.label}: rejected${who} — “${s.comment ?? ''}”${override}` },
    skipped: { tone: 'neutral' as const, icon: SkipForward, title: `${s.label}: skipped (${s.comment === 'self' ? 'approver is the sheet owner' : s.comment ?? ''})` },
  }[s.status];
  return { id: `r${s.round}-${s.position}`, title: map.title, tone: map.tone, icon: map.icon, at: s.decidedAt ? formatDateTime(s.decidedAt) : undefined };
}
function auditItem(a: AuditRow) {
  const who = a.actor ? ` by ${fullName(a.actor)}` : '';
  const map: Record<string, { title: string; tone: 'neutral' | 'info' | 'success' | 'danger' | 'indigo'; icon: typeof Check }> = {
    'sheet.submitted': { title: `Submitted${who}`, tone: 'info', icon: Send }, 'sheet.withdrawn': { title: `Withdrawn${who}`, tone: 'neutral', icon: Undo2 },
    'sheet.reopened': { title: `Reopened${who}${a.reason ? ` — ${a.reason}` : ''}`, tone: 'neutral', icon: RotateCcw }, 'sheet.paid': { title: `Marked paid${who}`, tone: 'success', icon: Wallet },
    'sheet.payment_reverted': { title: `Payment reverted${who}${a.reason ? ` — ${a.reason}` : ''}`, tone: 'danger', icon: Undo2 },
  };
  const m = map[a.action]; return m ? { id: a.id, title: m.title, tone: m.tone, icon: m.icon, at: formatDateTime(a.createdAt) } : null;
}
const rounds = computed(() => [...props.timeline.rounds].sort((a, b) => b.round - a.round).map((r) => ({ round: r.round, items: r.steps.map(stepItem) })));
const events = computed(() => props.timeline.audit.map(auditItem).filter((x): x is NonNullable<typeof x> => Boolean(x)).reverse());
</script>
<template>
  <Card><template #header><h2 class="font-semibold">Approval history</h2></template>
    <div class="space-y-6">
      <div v-if="events.length"><p class="mb-2 text-sm font-medium text-muted-foreground">Events</p><Timeline :items="events" /></div>
      <div v-for="r in rounds" :key="r.round"><p class="mb-2 text-sm font-medium text-muted-foreground">Round {{ r.round }}</p><Timeline :items="r.items" /></div>
      <p v-if="!rounds.length && !events.length" class="text-sm text-muted-foreground">Not submitted yet.</p>
    </div>
  </Card>
</template>
```
Modify `src/features/sheets/SheetPage.vue`: import `RejectionBanner`, `ApprovalTimeline`, `SheetActions`, `workflowApi`, `useQuery`; add `const timeline = useQuery({ queryKey: ['timeline', props.id], queryFn: () => workflowApi.timeline(props.id) });`. In the template, inside the `space-y-6` div: before `SheetTotals`, `<RejectionBanner v-if="sheet.data.value.status === 'rejected' && sheet.data.value.rejectionReason" :reason="sheet.data.value.rejectionReason" :rejected-at="sheet.data.value.rejectedAt" />`; after `EntriesTable`, `<ApprovalTimeline v-if="timeline.data.value" :timeline="timeline.data.value" />`; replace `<div id="sheet-actions" />` with `<SheetActions :sheet="sheet.data.value" :is-owner="isOwner" :role="auth.user!.role" :invalidate="invalidate" />`.

- [ ] **Step 4: Run tests** → PASS. Manual: submit the seeded draft, see the chain in the confirm dialog, the timeline shows "waiting for Tara Platform Lead"; withdraw; resubmit.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add sheet submit, withdraw and reopen actions, rejection banner and approval timeline"
```

---

### Task 11: Approver inbox and review page with decision dialog

**Files:**
- Create: `src/features/approvals/InboxPage.vue`, `ReviewSheetPage.vue`, `components/DecisionDialog.vue`, `components/DecisionDialog.spec.ts`

**Interfaces:**
- `InboxPage`: tabs Waiting / Upcoming / Decided (tab in query string `?scope=`), counts from each query's `meta.total`, rows: employee, team, month, hours, step label, submitted, age ("3 days"); row click → `review`.
- `ReviewSheetPage` (`/approvals/:id`): read-only sheet (reuses `SheetTotals`, `EntriesTable` with `editable=false`, `ApprovalTimeline`) plus a sticky bar with Approve and Reject when the current user may act: `sheet.status === 'submitted'` and (current step approver or backup is me, or I am admin). Admin not named on the step sees an "Override as admin" note and the reason field is required.
- `DecisionDialog` props: `open`, `kind: 'approve' | 'reject'`, `requireOverrideReason: boolean`, `loading`; emits `update:open`, `confirm: [{ comment: string; overrideReason?: string }]`. Reject requires a reason ≥ 5 chars; approve comment optional.

- [ ] **Step 1: Write failing test**

`src/features/approvals/components/DecisionDialog.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import DecisionDialog from './DecisionDialog.vue';
describe('DecisionDialog', () => {
  it('reject requires a reason', async () => {
    const w = mount(DecisionDialog, { props: { open: true, kind: 'reject', requireOverrideReason: false }, attachTo: document.body });
    (document.body.querySelector('[data-confirm]') as HTMLButtonElement).click(); await flushPromises();
    expect(w.emitted('confirm')).toBeUndefined(); expect(document.body.textContent).toContain('at least 5 characters');
    const ta = document.body.querySelector('textarea') as HTMLTextAreaElement; ta.value = 'Missing ticket links'; ta.dispatchEvent(new Event('input'));
    (document.body.querySelector('[data-confirm]') as HTMLButtonElement).click(); await flushPromises();
    expect(w.emitted('confirm')?.[0]).toEqual([{ comment: 'Missing ticket links', overrideReason: undefined }]);
    w.unmount();
  });
  it('approve with override requires an override reason', async () => {
    const w = mount(DecisionDialog, { props: { open: true, kind: 'approve', requireOverrideReason: true }, attachTo: document.body });
    (document.body.querySelector('[data-confirm]') as HTMLButtonElement).click(); await flushPromises();
    expect(w.emitted('confirm')).toBeUndefined();
    w.unmount();
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`src/features/approvals/components/DecisionDialog.vue`:
```vue
<script setup lang="ts">
import { ref, watch } from 'vue';
import { Dialog, Button, FormField, Textarea } from '@/components/ui';
const props = defineProps<{ open: boolean; kind: 'approve' | 'reject'; requireOverrideReason: boolean; loading?: boolean }>();
const emit = defineEmits<{ 'update:open': [v: boolean]; confirm: [p: { comment: string; overrideReason?: string }] }>();
const comment = ref(''); const override = ref(''); const errors = ref<{ comment?: string; override?: string }>({});
watch(() => props.open, (o) => { if (o) { comment.value = ''; override.value = ''; errors.value = {}; } });
function confirm() {
  errors.value = {};
  if (props.kind === 'reject' && comment.value.trim().length < 5) errors.value.comment = 'Give the employee a reason (at least 5 characters)';
  if (props.requireOverrideReason && override.value.trim().length < 5) errors.value.override = 'Explain why you are acting on behalf of the approver (at least 5 characters)';
  if (Object.keys(errors.value).length) return;
  emit('confirm', { comment: comment.value.trim(), overrideReason: props.requireOverrideReason ? override.value.trim() : undefined });
}
</script>
<template>
  <Dialog :open="open" :title="kind === 'approve' ? 'Approve this sheet?' : 'Reject this sheet?'" :description="kind === 'approve' ? 'It moves to the next step, or to finance if this is the last step.' : 'It returns to the employee. Approval restarts from the first step after they resubmit.'" size="sm" @update:open="emit('update:open', $event)">
    <div class="space-y-4">
      <p v-if="requireOverrideReason" class="rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-sm">You are not the approver for this step. This will be recorded as an admin override.</p>
      <FormField :label="kind === 'approve' ? 'Comment (optional)' : 'Reason'" name="decision-comment" :error="errors.comment" :required="kind === 'reject'"><template #default="{ id, invalid }"><Textarea :id="id" v-model="comment" :invalid="invalid" :rows="3" /></template></FormField>
      <FormField v-if="requireOverrideReason" label="Override reason" name="override-reason" :error="errors.override" required><template #default="{ id, invalid }"><Textarea :id="id" v-model="override" :invalid="invalid" :rows="2" /></template></FormField>
    </div>
    <template #footer>
      <Button variant="outline" @click="emit('update:open', false)">Cancel</Button>
      <Button data-confirm :variant="kind === 'reject' ? 'destructive' : 'primary'" :loading="loading" @click="confirm">{{ kind === 'approve' ? 'Approve' : 'Reject' }}</Button>
    </template>
  </Dialog>
</template>
```

`src/features/approvals/InboxPage.vue`:
```vue
<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import type { ColumnDef } from '@tanstack/vue-table';
import { formatDistanceToNow } from 'date-fns';
import { inboxApi, type InboxScope } from '@/api/inbox.api';
import type { InboxRow } from '@/api/types';
import { formatHours, formatPeriod, fullName } from '@/lib/format';
import { messageFor } from '@/api/errors';
import { PageHeader, Tabs, DataTable, Pagination, Badge, StatusBadge } from '@/components/ui';
const route = useRoute(); const router = useRouter();
const scope = ref<InboxScope>((route.query.scope as InboxScope) || 'waiting'); const page = ref(1);
watch(scope, (s) => { page.value = 1; router.replace({ query: { ...route.query, scope: s } }); });
const q = useQuery({ queryKey: ['inbox', scope, page], queryFn: () => inboxApi.list(scope.value, page.value) });
const counts = { waiting: useQuery({ queryKey: ['inbox', 'waiting', 'count'], queryFn: () => inboxApi.list('waiting', 1, 1) }), upcoming: useQuery({ queryKey: ['inbox', 'upcoming', 'count'], queryFn: () => inboxApi.list('upcoming', 1, 1) }) };
const tabs = computed(() => [{ value: 'waiting', label: 'Waiting for me', count: counts.waiting.data.value?.meta.total }, { value: 'upcoming', label: 'Coming to me', count: counts.upcoming.data.value?.meta.total }, { value: 'decided', label: 'Decided by me' }]);
const columns = computed<ColumnDef<InboxRow, unknown>[]>(() => [
  { id: 'employee', header: 'Employee', cell: ({ row }) => h('div', [h('p', { class: 'font-medium' }, fullName(row.original.employee)), h('p', { class: 'text-sm text-muted-foreground' }, row.original.employee.teamName ?? '')]) },
  { accessorKey: 'period', header: 'Month', cell: ({ row }) => formatPeriod(row.original.period) },
  { accessorKey: 'totalHours', header: 'Hours', meta: { numeric: true }, cell: ({ row }) => formatHours(row.original.totalHours) },
  { id: 'step', header: 'Step', cell: ({ row }) => h(Badge, { tone: scope.value === 'decided' ? (row.original.step.status === 'approved' ? 'success' : 'danger') : 'info' }, () => `${row.original.step.position}. ${row.original.step.label}${scope.value === 'decided' ? ` · ${row.original.step.status}` : ''}`) },
  { id: 'status', header: 'Sheet', cell: ({ row }) => h(StatusBadge, { status: row.original.status }) },
  { id: 'age', header: scope.value === 'decided' ? 'Decided' : 'Waiting since', cell: ({ row }) => { const d = scope.value === 'decided' ? row.original.step.decidedAt : row.original.submittedAt; return d ? h('span', { class: 'num text-sm text-muted-foreground' }, formatDistanceToNow(new Date(d), { addSuffix: true })) : '—'; } },
]);
</script>
<template>
  <PageHeader title="Inbox" description="Sheets that need your decision, and the ones on their way to you." />
  <Tabs v-model="scope" :tabs="tabs">
    <template v-for="t in tabs" :key="t.value" #[t.value]>
      <DataTable :columns="columns" :rows="q.data.value?.data ?? []" :row-key="(r) => `${r.id}-${r.step.position}`" :loading="q.isPending.value" :error="q.isError.value ? messageFor(q.error.value) : null" :empty-title="scope === 'waiting' ? 'Nothing waiting for you' : scope === 'upcoming' ? 'Nothing on its way' : 'No decisions yet'" @retry="q.refetch()" @row-click="router.push({ name: 'review', params: { id: $event.id } })" />
      <Pagination v-if="q.data.value" :page="page" :page-size="q.data.value.meta.pageSize" :total="q.data.value.meta.total" @update:page="page = $event" />
    </template>
  </Tabs>
</template>
```

`src/features/approvals/ReviewSheetPage.vue`:
```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { Check, X } from 'lucide-vue-next';
import { useAuthStore } from '@/stores/auth.store';
import { workflowApi } from '@/api/workflow.api';
import { sheetsApi } from '@/api/sheets.api';
import { formatPeriod, fullName } from '@/lib/format';
import { messageFor } from '@/api/errors';
import { PageHeader, Button, StatusBadge, Skeleton, EmptyState } from '@/components/ui';
import { useSheet } from '@/features/sheets/useSheet';
import { useSheetAction } from '@/features/sheets/useSheetAction';
import SheetTotals from '@/features/sheets/components/SheetTotals.vue';
import EntriesTable from '@/features/sheets/components/EntriesTable.vue';
import ApprovalTimeline from '@/features/sheets/components/ApprovalTimeline.vue';
import DecisionDialog from './components/DecisionDialog.vue';
const props = defineProps<{ id: string }>();
const auth = useAuthStore(); const router = useRouter(); const qc = useQueryClient();
const { sheet, invalidate } = useSheet(props.id);
const timeline = useQuery({ queryKey: ['timeline', props.id], queryFn: () => workflowApi.timeline(props.id) });
const invalidateAll = () => Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['inbox'] })]);
const { run, pending } = useSheetAction(invalidateAll);
const current = computed(() => sheet.data.value?.steps.find((s) => s.position === sheet.data.value?.currentStepPosition && s.status === 'pending') ?? null);
const named = computed(() => Boolean(current.value && [current.value.approver.id, current.value.backupApprover?.id].includes(auth.user?.id)));
const canAct = computed(() => sheet.data.value?.status === 'submitted' && current.value && (named.value || auth.user?.role === 'admin'));
const dialog = ref<null | 'approve' | 'reject'>(null);
async function decide(p: { comment: string; overrideReason?: string }) {
  const s = sheet.data.value!; const kind = dialog.value!; dialog.value = null;
  const ok = await run(() => kind === 'approve' ? workflowApi.approve(s.id, s.version, p.comment || undefined, p.overrideReason) : workflowApi.reject(s.id, s.version, p.comment, p.overrideReason), kind === 'approve' ? 'Sheet approved' : 'Sheet rejected');
  if (ok) router.push({ name: 'inbox' });
}
</script>
<template>
  <Skeleton v-if="sheet.isPending.value" :lines="4" />
  <EmptyState v-else-if="sheet.isError.value" title="Could not load this sheet" :description="messageFor(sheet.error.value)"><template #action><Button variant="outline" @click="sheet.refetch()">Retry</Button></template></EmptyState>
  <template v-else-if="sheet.data.value">
    <PageHeader :title="`${fullName(sheet.data.value.employee)} · ${formatPeriod(sheet.data.value.period)}`" :description="`${sheet.data.value.employee.teamName ?? 'No team'}${current ? ` · Step ${current.position}: ${current.label}` : ''}`"><template #actions><StatusBadge :status="sheet.data.value.status" /></template></PageHeader>
    <div class="space-y-6">
      <SheetTotals :sheet="sheet.data.value" />
      <EntriesTable :entries="sheet.data.value.entries" :editable="false" @open-attachment="sheetsApi.openAttachment($event)" />
      <ApprovalTimeline v-if="timeline.data.value" :timeline="timeline.data.value" />
    </div>
    <div v-if="canAct" class="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <p v-if="!named" class="mr-auto text-sm text-warning">Acting as admin on behalf of {{ fullName(current!.approver) }}</p>
      <Button variant="destructive" data-action="reject" :loading="pending" @click="dialog = 'reject'"><X class="h-4 w-4" />Reject</Button>
      <Button data-action="approve" :loading="pending" @click="dialog = 'approve'"><Check class="h-4 w-4" />Approve</Button>
    </div>
    <DecisionDialog :open="dialog !== null" :kind="dialog ?? 'approve'" :require-override-reason="!named" :loading="pending" @update:open="(v) => !v && (dialog = null)" @confirm="decide" />
  </template>
</template>
```

- [ ] **Step 4: Run tests** → PASS. Manual with seed: log in as `tl.platform@overtrack.local`, Inbox shows emp2's sheet, approve it; log in as `dm.platform@` and see it waiting.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add approver inbox and review page with approve/reject dialog"
```

---

### Task 12: Notifications store and menu

**Files:**
- Create: `src/api/notifications.api.ts`, `src/stores/notifications.store.ts`, `src/stores/notifications.store.spec.ts`, `src/components/layout/NotificationsMenu.vue`
- Modify: `src/components/layout/Topbar.vue` (slot right → menu), `src/components/layout/AppShell.vue` (pass `inboxCount` to Sidebar), `src/features/dashboard/DashboardPage.vue` (recent activity list from notifications)

**Interfaces:**
- `notificationsApi.list(unreadOnly?, page?) → Paged<Notification> & { meta: { unread } }`, `markRead(id)`, `markAllRead()`.
- `useNotificationsStore`: state `items`, `unread`, `loaded`; actions `load()`, `markRead(id)`, `markAllRead()`, `startPolling(ms = 60_000)`, `stopPolling()`; getter `waitingCount` = unread items of type `sheet.submitted`.
- `NotificationsMenu`: bell with unread badge; dropdown list of last 10, each a link (`link` is a path like `/approvals/:id`), clicking marks read then navigates; "Mark all read" button.

- [ ] **Step 1: Write failing test**

`src/stores/notifications.store.spec.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
vi.mock('@/api/notifications.api', () => ({ notificationsApi: {
  list: vi.fn(async () => ({ data: [{ id: 'n1', type: 'sheet.submitted', title: 't', body: 'b', link: '/approvals/s', readAt: null, createdAt: '2026-10-01T00:00:00Z' }, { id: 'n2', type: 'sheet.paid', title: 't', body: 'b', link: '/sheets/s', readAt: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z' }], meta: { page: 1, pageSize: 10, total: 2, unread: 1 } })),
  markRead: vi.fn(async () => {}), markAllRead: vi.fn(async () => {}),
} }));
import { useNotificationsStore } from './notifications.store';
describe('notifications store', () => {
  beforeEach(() => setActivePinia(createPinia()));
  it('loads, counts unread, marks read optimistically', async () => {
    const s = useNotificationsStore(); await s.load();
    expect(s.unread).toBe(1); expect(s.waitingCount).toBe(1);
    await s.markRead('n1');
    expect(s.unread).toBe(0); expect(s.items[0].readAt).not.toBeNull();
    await s.markAllRead(); expect(s.items.every((i) => i.readAt)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`src/api/notifications.api.ts`:
```ts
import { get, post } from './client';
import type { Notification } from './types';
export interface NotificationPage { data: Notification[]; meta: { page: number; pageSize: number; total: number; unread: number } }
export const notificationsApi = {
  list: (unreadOnly = false, page = 1, pageSize = 10) => get<NotificationPage>('/me/notifications', { unreadOnly: unreadOnly ? 'true' : undefined, page, pageSize }),
  markRead: (id: string) => post<void>(`/me/notifications/${id}/read`),
  markAllRead: () => post<void>('/me/notifications/read-all'),
};
```

`src/stores/notifications.store.ts`:
```ts
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { notificationsApi } from '@/api/notifications.api';
import type { Notification } from '@/api/types';
export const useNotificationsStore = defineStore('notifications', () => {
  const items = ref<Notification[]>([]); const unread = ref(0); const loaded = ref(false); let timer: ReturnType<typeof setInterval> | null = null;
  async function load() { try { const r = await notificationsApi.list(false, 1, 10); items.value = r.data; unread.value = r.meta.unread; loaded.value = true; } catch { /* keep last state */ } }
  async function markRead(id: string) {
    const n = items.value.find((i) => i.id === id); if (!n || n.readAt) return;
    n.readAt = new Date().toISOString(); unread.value = Math.max(0, unread.value - 1);
    try { await notificationsApi.markRead(id); } catch { await load(); }
  }
  async function markAllRead() { items.value.forEach((i) => { i.readAt ??= new Date().toISOString(); }); unread.value = 0; try { await notificationsApi.markAllRead(); } catch { await load(); } }
  function startPolling(ms = 60_000) { stopPolling(); load(); timer = setInterval(load, ms); }
  function stopPolling() { if (timer) clearInterval(timer); timer = null; }
  const waitingCount = computed(() => items.value.filter((i) => !i.readAt && i.type === 'sheet.submitted').length);
  return { items, unread, loaded, load, markRead, markAllRead, startPolling, stopPolling, waitingCount };
});
```

`src/components/layout/NotificationsMenu.vue`:
```vue
<script setup lang="ts">
import { useRouter } from 'vue-router';
import { Bell, CheckCheck } from 'lucide-vue-next';
import { formatDistanceToNow } from 'date-fns';
import { DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent, DropdownMenuItem } from 'reka-ui';
import { useNotificationsStore } from '@/stores/notifications.store';
import { Button } from '@/components/ui';
const store = useNotificationsStore(); const router = useRouter();
async function open(n: { id: string; link: string | null }) { await store.markRead(n.id); if (n.link) router.push(n.link); }
</script>
<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <button type="button" class="relative flex h-11 w-11 items-center justify-center rounded-control text-muted-foreground hover:bg-muted cursor-pointer" :aria-label="`Notifications, ${store.unread} unread`">
        <Bell class="h-5 w-5" /><span v-if="store.unread" class="num absolute right-1.5 top-1.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-medium leading-4 text-on-destructive">{{ store.unread > 9 ? '9+' : store.unread }}</span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent align="end" :side-offset="4" class="z-50 w-[calc(100vw-2rem)] max-w-sm rounded-card border bg-surface p-2 shadow-dialog">
        <div class="flex items-center justify-between px-2 py-1"><p class="font-medium">Notifications</p><Button variant="ghost" size="sm" :disabled="!store.unread" @click="store.markAllRead()"><CheckCheck class="h-4 w-4" />Mark all read</Button></div>
        <p v-if="!store.items.length" class="px-2 py-6 text-center text-sm text-muted-foreground">You are all caught up.</p>
        <DropdownMenuItem v-for="n in store.items" :key="n.id" class="flex cursor-pointer flex-col items-start gap-0.5 rounded-control px-2 py-2 outline-none data-[highlighted]:bg-muted" :class="n.readAt ? 'opacity-70' : ''" @select="open(n)">
          <p class="text-sm font-medium">{{ n.title }}</p><p class="text-sm text-muted-foreground">{{ n.body }}</p><p class="num text-xs text-muted-foreground">{{ formatDistanceToNow(new Date(n.createdAt), { addSuffix: true }) }}</p>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
```

Modify `Topbar.vue`: import and render `<NotificationsMenu />` before `<ThemeToggle />`. Modify `AppShell.vue`: `const notifications = useNotificationsStore(); onMounted(() => notifications.startPolling()); onUnmounted(() => notifications.stopPolling());` and pass `:inbox-count="notifications.waitingCount"` to both `<Sidebar>` usages. Modify `DashboardPage.vue`: replace the "My recent sheets" card with a two-column grid: "Recent activity" (from `notifications.items.slice(0, 5)`, each linking to `n.link`) and "My recent sheets".

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add notifications store, bell menu and sidebar inbox badge"
```

---

### Task 13: Team month page with export

**Files:**
- Create: `src/api/teams.api.ts`, `src/api/reports.api.ts`, `src/lib/download.ts`, `src/features/reports/TeamMonthPage.vue`, `components/TeamMonthTable.vue`, `components/ExportButton.vue`, `components/TeamMonthTable.spec.ts`

**Interfaces:**
- `teamsApi.list(q) → Paged<TeamSummary>`, `get(id)`, `members(id) → PublicUser[]`, `create`, `update`.
- `reportsApi.teamMonth({ teamId, period, status? }) → TeamMonthReport`, `exportTeamMonth(params, format) → Promise<void>` (downloads), `exportEmployees(params, format)`.
- `download.ts`: `downloadResponse(res: Response, fallbackName)` reads `content-disposition` filename, creates a blob URL and clicks an `<a download>`.
- `TeamMonthPage`: query-string state `teamId`, `period` (default current period), `status`; team `Select` from `teamsApi.list({ pageSize: 100 })`; month input (`<input type="month">`); status filter; `TeamMonthTable`; `ExportButton` (dropdown XLSX / CSV).
- `TeamMonthTable` props: `report: TeamMonthReport`; one row per employee: name + code, one numeric column per `report.types`, Total, Weighted, Status (`StatusBadge` or "No sheet"), Paid (`paidAt` date or —); footer totals row; expandable rows showing the employee's entries via `EntriesTable` (read-only); row click opens the sheet page when a sheet exists.

- [ ] **Step 1: Write failing test**

`src/features/reports/components/TeamMonthTable.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import TeamMonthTable from './TeamMonthTable.vue';
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const report = {
  team: { id: 't', name: 'Platform' }, period: '2026-09', types: [{ id: 'wd', name: 'Weekday', multiplier: 1.5, color: '#000' }, { id: 'we', name: 'Weekend', multiplier: 2, color: '#000' }],
  rows: [
    { employee: { id: 'a', firstName: 'Ann', lastName: 'Lee', employeeCode: 'E1' }, sheet: { id: 's', status: 'approved', paidAt: null } as never, hoursByType: { wd: 2, we: 4 }, totalHours: 6, totalWeightedHours: 11, entries: [] },
    { employee: { id: 'b', firstName: 'Bob', lastName: 'Ray', employeeCode: null }, sheet: null, hoursByType: {}, totalHours: 0, totalWeightedHours: 0, entries: [] },
  ],
  totals: { totalHours: 6, totalWeightedHours: 11, hoursByType: { wd: 2, we: 4 } },
};
describe('TeamMonthTable', () => {
  it('renders per-type columns, rows and a totals footer', () => {
    const w = mount(TeamMonthTable, { props: { report: report as never } });
    const headers = w.findAll('thead th').map((t) => t.text());
    expect(headers).toEqual(expect.arrayContaining(['Weekday (h)', 'Weekend (h)', 'Total', 'Weighted']));
    expect(w.text()).toContain('Ann Lee'); expect(w.text()).toContain('No sheet');
    expect(w.find('tfoot').text()).toContain('11.00');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`src/api/teams.api.ts`:
```ts
import { get, post, patch } from './client';
import type { Paged, PublicUser, TeamSummary } from './types';
export const teamsApi = {
  list: (q: { search?: string; isActive?: 'true' | 'false'; page?: number; pageSize?: number } = {}) => get<Paged<TeamSummary>>('/teams', q),
  get: (id: string) => get<{ data: TeamSummary }>(`/teams/${id}`).then((r) => r.data),
  members: (id: string) => get<{ data: PublicUser[] }>(`/teams/${id}/members`).then((r) => r.data),
  create: (b: { name: string; description?: string | null; techLeadId?: string | null }) => post<{ data: TeamSummary }>('/teams', b).then((r) => r.data),
  update: (id: string, b: Partial<{ name: string; description: string | null; techLeadId: string | null; isActive: boolean }>) => patch<{ data: TeamSummary }>(`/teams/${id}`, b).then((r) => r.data),
};
```

`src/lib/download.ts`:
```ts
export async function downloadResponse(res: Response, fallbackName: string): Promise<void> {
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
```

`src/api/reports.api.ts`:
```ts
import { get, request } from './client';
import type { TeamMonthReport } from './types';
import { downloadResponse } from '@/lib/download';
type Params = { teamId?: string; period: string; status?: string };
export const reportsApi = {
  teamMonth: (p: Params & { teamId: string }) => get<{ data: TeamMonthReport }>('/reports/team-month', p).then((r) => r.data),
  exportTeamMonth: async (p: Params & { teamId: string }, format: 'xlsx' | 'csv') => downloadResponse(await request<Response>('GET', '/reports/team-month/export', { query: { ...p, format }, raw: true }), `overtrack-${p.period}.${format}`),
  exportEmployees: async (p: Params, format: 'xlsx' | 'csv') => downloadResponse(await request<Response>('GET', '/reports/employees/export', { query: { ...p, format }, raw: true }), `overtrack-all-${p.period}.${format}`),
};
```

`src/features/reports/components/ExportButton.vue`:
```vue
<script setup lang="ts">
import { ref } from 'vue';
import { Download } from 'lucide-vue-next';
import { messageFor } from '@/api/errors';
import { useToast } from '@/components/ui/useToast';
import { Button, DropdownMenu } from '@/components/ui';
const props = defineProps<{ run: (format: 'xlsx' | 'csv') => Promise<void>; disabled?: boolean }>();
const { toast } = useToast(); const loading = ref(false);
async function go(format: 'xlsx' | 'csv') { loading.value = true; try { await props.run(format); } catch (e) { toast({ title: messageFor(e), tone: 'error' }); } finally { loading.value = false; } }
const items = [{ label: 'Excel (.xlsx)', onSelect: () => go('xlsx') }, { label: 'CSV', onSelect: () => go('csv') }];
</script>
<template>
  <DropdownMenu :items="items"><template #trigger><Button variant="outline" :loading="loading" :disabled="disabled"><Download class="h-4 w-4" />Export</Button></template></DropdownMenu>
</template>
```

`src/features/reports/components/TeamMonthTable.vue`:
```vue
<script setup lang="ts">
import { computed, h } from 'vue';
import { useRouter } from 'vue-router';
import type { ColumnDef } from '@tanstack/vue-table';
import type { TeamMonthReport, TeamMonthRow } from '@/api/types';
import { formatHours, formatDate, fullName } from '@/lib/format';
import { sheetsApi } from '@/api/sheets.api';
import { DataTable, StatusBadge } from '@/components/ui';
import EntriesTable from '@/features/sheets/components/EntriesTable.vue';
const props = defineProps<{ report: TeamMonthReport; loading?: boolean }>();
const router = useRouter();
const columns = computed<ColumnDef<TeamMonthRow, unknown>[]>(() => [
  { id: 'employee', header: 'Employee', cell: ({ row }) => h('div', [h('p', { class: 'font-medium' }, fullName(row.original.employee)), h('p', { class: 'num text-sm text-muted-foreground' }, row.original.employee.employeeCode ?? '')]) },
  ...props.report.types.map<ColumnDef<TeamMonthRow, unknown>>((t) => ({ id: `type-${t.id}`, header: `${t.name} (h)`, meta: { numeric: true }, cell: ({ row }) => formatHours(row.original.hoursByType[t.id] ?? 0) })),
  { accessorKey: 'totalHours', header: 'Total', meta: { numeric: true }, cell: ({ row }) => h('span', { class: 'font-medium' }, formatHours(row.original.totalHours)) },
  { accessorKey: 'totalWeightedHours', header: 'Weighted', meta: { numeric: true }, cell: ({ row }) => h('span', { class: 'font-medium' }, formatHours(row.original.totalWeightedHours)) },
  { id: 'status', header: 'Status', cell: ({ row }) => row.original.sheet ? h(StatusBadge, { status: row.original.sheet.status }) : h('span', { class: 'text-sm text-muted-foreground' }, 'No sheet') },
  { id: 'paid', header: 'Paid', cell: ({ row }) => h('span', { class: 'num text-sm' }, row.original.sheet?.paidAt ? formatDate(row.original.sheet.paidAt.slice(0, 10)) : '—') },
]);
</script>
<template>
  <div>
    <DataTable :columns="columns" :rows="report.rows" :row-key="(r) => r.employee.id" :loading="loading" expandable empty-title="No team members" @row-click="$event.sheet && router.push({ name: 'sheet', params: { id: $event.sheet.id } })">
      <template #expanded="{ row }"><EntriesTable :entries="row.entries" :editable="false" @open-attachment="sheetsApi.openAttachment($event)" /></template>
    </DataTable>
    <table class="mt-2 w-full text-sm" aria-label="Totals"><tfoot><tr class="rounded-card border bg-muted/40"><td class="px-4 py-3 font-medium">Team totals</td><td v-for="t in report.types" :key="t.id" class="num px-4 py-3 text-right">{{ formatHours(report.totals.hoursByType[t.id] ?? 0) }}</td><td class="num px-4 py-3 text-right font-semibold">{{ formatHours(report.totals.totalHours) }}</td><td class="num px-4 py-3 text-right font-semibold">{{ formatHours(report.totals.totalWeightedHours) }}</td><td colspan="2" /></tr></tfoot></table>
  </div>
</template>
```
The totals are a separate `<table>` placed directly under the main one so the DataTable stays generic; align column widths with `table-fixed` on both if they drift visually.

`src/features/reports/TeamMonthPage.vue`:
```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import { teamsApi } from '@/api/teams.api';
import { reportsApi } from '@/api/reports.api';
import { currentPeriod } from '@/lib/dates';
import { messageFor } from '@/api/errors';
import { PageHeader, Select, FormField, EmptyState, Skeleton, Button } from '@/components/ui';
import TeamMonthTable from './components/TeamMonthTable.vue';
import ExportButton from './components/ExportButton.vue';
const route = useRoute(); const router = useRouter();
const teamId = ref<string | null>((route.query.teamId as string) || null); const period = ref((route.query.period as string) || currentPeriod()); const status = ref<string | null>((route.query.status as string) || null);
watch([teamId, period, status], ([t, p, s]) => router.replace({ query: { teamId: t ?? undefined, period: p, status: s ?? undefined } }));
const teams = useQuery({ queryKey: ['teams', 'all'], queryFn: () => teamsApi.list({ isActive: 'true', pageSize: 100 }) });
const teamOptions = computed(() => (teams.data.value?.data ?? []).map((t) => ({ value: t.id, label: t.name })));
watch(teamOptions, (o) => { if (!teamId.value && o[0]) teamId.value = o[0].value; }, { immediate: true });
const statusOptions = [{ value: 'all', label: 'All statuses' }, ...['draft', 'submitted', 'approved', 'paid', 'rejected'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))];
const params = computed(() => ({ teamId: teamId.value!, period: period.value, status: status.value && status.value !== 'all' ? status.value : undefined }));
const report = useQuery({ queryKey: ['team-month', params], queryFn: () => reportsApi.teamMonth(params.value), enabled: computed(() => Boolean(teamId.value)) });
</script>
<template>
  <PageHeader title="Team month" description="Everyone on the team for one month, with hours per overtime type.">
    <template #actions><ExportButton :disabled="!teamId" :run="(f) => reportsApi.exportTeamMonth(params, f)" /></template>
  </PageHeader>
  <div class="mb-6 grid gap-4 sm:grid-cols-3">
    <FormField label="Team" name="teamId"><template #default="{ id }"><Select :id="id" v-model="teamId" :options="teamOptions" placeholder="Pick a team" /></template></FormField>
    <FormField label="Month" name="period"><template #default="{ id }"><input :id="id" v-model="period" type="month" class="num h-11 w-full rounded-control border bg-surface px-3 text-base" /></template></FormField>
    <FormField label="Status" name="status"><template #default="{ id }"><Select :id="id" :model-value="status ?? 'all'" :options="statusOptions" @update:model-value="status = $event" /></template></FormField>
  </div>
  <Skeleton v-if="report.isPending.value && teamId" :lines="5" />
  <EmptyState v-else-if="report.isError.value" title="Could not load the report" :description="messageFor(report.error.value)"><template #action><Button variant="outline" @click="report.refetch()">Retry</Button></template></EmptyState>
  <EmptyState v-else-if="!teamId" title="Pick a team" description="You can see teams where you are the tech lead or on the approval chain." />
  <TeamMonthTable v-else-if="report.data.value" :report="report.data.value" :loading="report.isFetching.value" />
</template>
```

- [ ] **Step 4: Run tests** → PASS. Manual: as `finance@`, pick Platform, last month; expand a row; export XLSX downloads a file named `overtrack-platform-<period>.xlsx`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add team month report page with per-type columns, expansion and export"
```

---

### Task 14: Payments page (finance)

**Files:**
- Create: `src/features/payments/PaymentsPage.vue`, `components/MarkPaidDialog.vue`, `components/MarkPaidDialog.spec.ts`

**Interfaces:**
- `PaymentsPage`: Tabs "Approved, unpaid" / "Paid". Filters: month (`type=month`), team Select ("All teams"). Approved tab: checkbox column (header checkbox selects page), action bar "Mark paid (n)" opens `MarkPaidDialog`; rows: employee, team, month, hours, weighted, approved at. Paid tab: rows add paid at, reference, and a "Revert" ghost button opening `ConfirmDialog` with required reason. Also an "Export all" `ExportButton` calling `reportsApi.exportEmployees({ period, teamId, status: 'approved'|'paid' })`.
- `MarkPaidDialog` props: `open`, `sheets: SheetSummary[]`, `loading`; emits `update:open`, `confirm: [{ paymentReference: string; paidAt?: string }]`. Reference required (1–60), paid date defaults to today. Shows a summary: n sheets, total weighted hours.
- After bulk: toast "Marked n paid"; if `failed.length`, a second error toast listing codes; invalidate `['sheets']`.

- [ ] **Step 1: Write failing test**

`src/features/payments/components/MarkPaidDialog.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import MarkPaidDialog from './MarkPaidDialog.vue';
const sheets = [{ id: 'a', totalWeightedHours: 3, employee: { firstName: 'A', lastName: 'B' } }, { id: 'b', totalWeightedHours: 4.5, employee: { firstName: 'C', lastName: 'D' } }] as never[];
describe('MarkPaidDialog', () => {
  it('requires a reference and emits reference + date', async () => {
    const w = mount(MarkPaidDialog, { props: { open: true, sheets }, attachTo: document.body });
    expect(document.body.textContent).toContain('2 sheets'); expect(document.body.textContent).toContain('7.50');
    (document.body.querySelector('[data-confirm]') as HTMLButtonElement).click(); await flushPromises();
    expect(w.emitted('confirm')).toBeUndefined();
    const input = document.body.querySelector('input[name="paymentReference"]') as HTMLInputElement; input.value = 'PAY-10'; input.dispatchEvent(new Event('input'));
    (document.body.querySelector('[data-confirm]') as HTMLButtonElement).click(); await flushPromises();
    expect(w.emitted('confirm')?.[0]?.[0]).toMatchObject({ paymentReference: 'PAY-10' });
    w.unmount();
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`src/features/payments/components/MarkPaidDialog.vue`:
```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { SheetSummary } from '@/api/types';
import { formatHours } from '@/lib/format';
import { todayIso } from '@/lib/dates';
import { Dialog, Button, FormField, Input, DatePicker } from '@/components/ui';
const props = defineProps<{ open: boolean; sheets: SheetSummary[]; loading?: boolean }>();
const emit = defineEmits<{ 'update:open': [v: boolean]; confirm: [p: { paymentReference: string; paidAt?: string }] }>();
const reference = ref(''); const paidAt = ref<string | null>(todayIso()); const error = ref('');
watch(() => props.open, (o) => { if (o) { reference.value = ''; paidAt.value = todayIso(); error.value = ''; } });
const weighted = computed(() => props.sheets.reduce((a, s) => a + s.totalWeightedHours, 0));
function confirm() {
  const r = reference.value.trim();
  if (!r) { error.value = 'Enter the payroll batch or payment reference'; return; }
  if (r.length > 60) { error.value = 'At most 60 characters'; return; }
  emit('confirm', { paymentReference: r, paidAt: paidAt.value ? new Date(`${paidAt.value}T12:00:00`).toISOString() : undefined });
}
</script>
<template>
  <Dialog :open="open" title="Mark as paid" :description="`${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'} · ${formatHours(weighted)} weighted hours`" size="sm" @update:open="emit('update:open', $event)">
    <div class="space-y-4">
      <FormField label="Payment reference" name="paymentReference" :error="error" hint="Payroll batch id or transfer reference" required><template #default="{ id, invalid }"><Input :id="id" v-model="reference" name="paymentReference" mono :invalid="invalid" /></template></FormField>
      <FormField label="Paid on" name="paidAt"><template #default="{ id }"><DatePicker :id="id" v-model="paidAt" :max="todayIso()" /></template></FormField>
    </div>
    <template #footer><Button variant="outline" @click="emit('update:open', false)">Cancel</Button><Button data-confirm :loading="loading" @click="confirm">Mark paid</Button></template>
  </Dialog>
</template>
```

`src/features/payments/PaymentsPage.vue`:
```vue
<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import type { ColumnDef } from '@tanstack/vue-table';
import { sheetsApi } from '@/api/sheets.api';
import { teamsApi } from '@/api/teams.api';
import { workflowApi } from '@/api/workflow.api';
import { reportsApi } from '@/api/reports.api';
import type { SheetSummary } from '@/api/types';
import { formatHours, formatPeriod, formatDateTime, fullName } from '@/lib/format';
import { messageFor } from '@/api/errors';
import { useToast } from '@/components/ui/useToast';
import { PageHeader, Tabs, DataTable, Pagination, Checkbox, Button, Select, FormField, ConfirmDialog } from '@/components/ui';
import { useSheetAction } from '@/features/sheets/useSheetAction';
import ExportButton from '@/features/reports/components/ExportButton.vue';
import MarkPaidDialog from './components/MarkPaidDialog.vue';
const router = useRouter(); const qc = useQueryClient(); const { toast } = useToast();
const tab = ref<'approved' | 'paid'>('approved'); const page = ref(1); const period = ref(''); const teamId = ref<string | null>(null);
watch([tab, period, teamId], () => { page.value = 1; selected.value = new Set(); });
const teams = useQuery({ queryKey: ['teams', 'all'], queryFn: () => teamsApi.list({ isActive: 'true', pageSize: 100 }) });
const teamOptions = computed(() => [{ value: 'all', label: 'All teams' }, ...(teams.data.value?.data ?? []).map((t) => ({ value: t.id, label: t.name }))]);
const params = computed(() => ({ status: tab.value, period: period.value || undefined, teamId: teamId.value && teamId.value !== 'all' ? teamId.value : undefined, page: page.value, pageSize: 50 }));
const q = useQuery({ queryKey: ['sheets', 'payments', params], queryFn: () => sheetsApi.list(params.value) });
const invalidate = () => qc.invalidateQueries({ queryKey: ['sheets'] });
const { run, pending } = useSheetAction(invalidate);

const selected = ref<Set<string>>(new Set());
const rows = computed(() => q.data.value?.data ?? []);
const allSelected = computed(() => rows.value.length > 0 && rows.value.every((r) => selected.value.has(r.id)));
function toggleAll(v: boolean) { selected.value = v ? new Set(rows.value.map((r) => r.id)) : new Set(); }
function toggle(id: string, v: boolean) { const n = new Set(selected.value); v ? n.add(id) : n.delete(id); selected.value = n; }
const selectedSheets = computed(() => rows.value.filter((r) => selected.value.has(r.id)));
const payOpen = ref(false); const paying = ref(false); const reverting = ref<SheetSummary | null>(null);
async function pay(p: { paymentReference: string; paidAt?: string }) {
  paying.value = true;
  try {
    const res = await workflowApi.markPaidBulk(selectedSheets.value.map((s) => ({ id: s.id, version: s.version })), p.paymentReference);
    toast({ title: `Marked ${res.paid.length} paid`, tone: 'success' });
    if (res.failed.length) toast({ title: `${res.failed.length} could not be paid`, description: res.failed.map((f) => f.code).join(', '), tone: 'error' });
    payOpen.value = false; selected.value = new Set(); await invalidate();
  } catch (e) { toast({ title: messageFor(e), tone: 'error' }); } finally { paying.value = false; }
}
async function revert(reason: string) { const s = reverting.value!; reverting.value = null; await run(() => workflowApi.revertPaid(s.id, s.version, reason), 'Payment reverted'); }

const columns = computed<ColumnDef<SheetSummary, unknown>[]>(() => [
  ...(tab.value === 'approved' ? [{ id: 'select', header: () => h(Checkbox, { modelValue: allSelected.value, ariaLabel: 'Select all', 'onUpdate:modelValue': toggleAll }), cell: ({ row }: { row: { original: SheetSummary } }) => h('div', { onClick: (e: Event) => e.stopPropagation() }, [h(Checkbox, { modelValue: selected.value.has(row.original.id), ariaLabel: `Select ${fullName(row.original.employee)}`, 'onUpdate:modelValue': (v: boolean) => toggle(row.original.id, v) })]) } as ColumnDef<SheetSummary, unknown>] : []),
  { id: 'employee', header: 'Employee', cell: ({ row }) => h('div', [h('p', { class: 'font-medium' }, fullName(row.original.employee)), h('p', { class: 'text-sm text-muted-foreground' }, row.original.employee.teamName ?? '')]) },
  { accessorKey: 'period', header: 'Month', cell: ({ row }) => formatPeriod(row.original.period) },
  { accessorKey: 'totalHours', header: 'Hours', meta: { numeric: true }, cell: ({ row }) => formatHours(row.original.totalHours) },
  { accessorKey: 'totalWeightedHours', header: 'Weighted', meta: { numeric: true }, cell: ({ row }) => formatHours(row.original.totalWeightedHours) },
  ...(tab.value === 'approved'
    ? [{ id: 'approvedAt', header: 'Approved', cell: ({ row }) => h('span', { class: 'num text-sm' }, row.original.approvedAt ? formatDateTime(row.original.approvedAt) : '—') } as ColumnDef<SheetSummary, unknown>]
    : [
        { id: 'paidAt', header: 'Paid', cell: ({ row }) => h('span', { class: 'num text-sm' }, row.original.paidAt ? formatDateTime(row.original.paidAt) : '—') } as ColumnDef<SheetSummary, unknown>,
        { id: 'ref', header: 'Reference', cell: ({ row }) => h('span', { class: 'num' }, row.original.paymentReference ?? '') } as ColumnDef<SheetSummary, unknown>,
        { id: 'revert', header: '', cell: ({ row }) => h(Button, { variant: 'ghost', size: 'sm', onClick: (e: Event) => { e.stopPropagation(); reverting.value = row.original; } }, () => 'Revert') } as ColumnDef<SheetSummary, unknown>,
      ]),
]);
</script>
<template>
  <PageHeader title="Payments" description="Approved sheets waiting for payroll, and what has already been paid.">
    <template #actions><ExportButton :run="(f) => reportsApi.exportEmployees({ period: period || new Date().toISOString().slice(0, 7), teamId: params.teamId, status: tab }, f)" /></template>
  </PageHeader>
  <div class="mb-4 grid gap-4 sm:grid-cols-3">
    <FormField label="Month" name="period" hint="Leave empty for all months"><template #default="{ id }"><input :id="id" v-model="period" type="month" class="num h-11 w-full rounded-control border bg-surface px-3 text-base" /></template></FormField>
    <FormField label="Team" name="team"><template #default="{ id }"><Select :id="id" :model-value="teamId ?? 'all'" :options="teamOptions" @update:model-value="teamId = $event" /></template></FormField>
  </div>
  <Tabs v-model="tab" :tabs="[{ value: 'approved', label: 'Approved, unpaid', count: tab === 'approved' ? q.data.value?.meta.total : undefined }, { value: 'paid', label: 'Paid' }]">
    <template #approved>
      <div v-if="selected.size" class="mb-3 flex items-center gap-3 rounded-card border bg-primary/5 px-4 py-2"><p class="text-sm">{{ selected.size }} selected</p><Button size="sm" @click="payOpen = true">Mark paid ({{ selected.size }})</Button><Button size="sm" variant="ghost" @click="selected = new Set()">Clear</Button></div>
      <DataTable :columns="columns" :rows="rows" :row-key="(s) => s.id" :loading="q.isPending.value" :error="q.isError.value ? messageFor(q.error.value) : null" empty-title="Nothing waiting for payment" @retry="q.refetch()" @row-click="router.push({ name: 'sheet', params: { id: $event.id } })" />
      <Pagination v-if="q.data.value" :page="page" :page-size="q.data.value.meta.pageSize" :total="q.data.value.meta.total" @update:page="page = $event" />
    </template>
    <template #paid>
      <DataTable :columns="columns" :rows="rows" :row-key="(s) => s.id" :loading="q.isPending.value" :error="q.isError.value ? messageFor(q.error.value) : null" empty-title="No paid sheets" @retry="q.refetch()" @row-click="router.push({ name: 'sheet', params: { id: $event.id } })" />
      <Pagination v-if="q.data.value" :page="page" :page-size="q.data.value.meta.pageSize" :total="q.data.value.meta.total" @update:page="page = $event" />
    </template>
  </Tabs>
  <MarkPaidDialog v-model:open="payOpen" :sheets="selectedSheets" :loading="paying" @confirm="pay" />
  <ConfirmDialog :open="Boolean(reverting)" title="Revert this payment?" :description="reverting ? `${fullName(reverting.employee)} · ${formatPeriod(reverting.period)} · ${reverting.paymentReference}` : ''" confirm-label="Revert" destructive require-reason :loading="pending" @update:open="(v) => !v && (reverting = null)" @confirm="revert" />
</template>
```

- [ ] **Step 4: Run tests** → PASS. Manual as `finance@`: select the approved seeded sheet, mark paid with `BATCH-X`, see it under Paid; revert it with a reason.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add payments page with bulk mark-paid and revert"
```

---

### Task 15: Admin users page

**Files:**
- Create: `src/features/admin/UsersPage.vue`, `src/features/admin/UserFormDrawer.vue`, `src/features/admin/UserFormDrawer.spec.ts`, `src/features/admin/roles.ts`

**Interfaces:**
- `roles.ts`: `ROLE_OPTIONS: Array<{ value: UserRole; label: string }>` and `roleLabel(role)`.
- `UsersPage`: search input (debounced 300 ms via `@vueuse/core` `useDebounceFn`), role Select, active Select, table (name + email, code, role badge, team, active badge, actions menu: Edit, Resend invite, Deactivate/Reactivate with ConfirmDialog), "Invite user" button → `UserFormDrawer`.
- `UserFormDrawer` props: `open`, `user?: PublicUser | null`, `teams: TeamSummary[]`; emits `update:open`, `saved`. Fields: first name, last name, email (read-only in edit), role, team, employee code, timezone (text with hint, default from browser). Zod validation; server field errors mapped.

- [ ] **Step 1: Write failing test**

`src/features/admin/UserFormDrawer.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import UserFormDrawer from './UserFormDrawer.vue';
import { ApiError } from '@/api/errors';
const create = vi.fn();
vi.mock('@/api/users.api', () => ({ usersApi: { create: (...a: unknown[]) => create(...a), update: vi.fn() } }));
describe('UserFormDrawer', () => {
  it('validates, then maps EMAIL_TAKEN to the email field', async () => {
    create.mockRejectedValueOnce(new ApiError(409, 'EMAIL_TAKEN', 'x'));
    const w = mount(UserFormDrawer, { props: { open: true, teams: [] }, attachTo: document.body });
    const form = document.body.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true })); await flushPromises();
    expect(create).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('Enter a first name');
    const set = (name: string, v: string) => { const el = document.body.querySelector(`[name="${name}"]`) as HTMLInputElement; el.value = v; el.dispatchEvent(new Event('input')); };
    set('firstName', 'Nora'); set('lastName', 'K'); set('email', 'nora@t.local');
    form.dispatchEvent(new Event('submit', { cancelable: true })); await flushPromises();
    expect(create).toHaveBeenCalled(); expect(document.body.textContent).toContain('already in use');
    w.unmount();
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`src/features/admin/roles.ts`:
```ts
import type { UserRole } from '@/api/types';
export const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'employee', label: 'Employee' }, { value: 'tech_lead', label: 'Tech lead' }, { value: 'delivery_manager', label: 'Delivery manager' }, { value: 'cto', label: 'CTO' }, { value: 'finance', label: 'Finance' }, { value: 'admin', label: 'Admin' },
];
export const roleLabel = (r: UserRole) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;
```

`src/features/admin/UserFormDrawer.vue`:
```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useForm } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import { z } from 'zod';
import type { PublicUser, TeamSummary, UserRole } from '@/api/types';
import { usersApi } from '@/api/users.api';
import { messageFor, fieldErrors, ApiError } from '@/api/errors';
import { useToast } from '@/components/ui/useToast';
import { Drawer, Button, FormField, Input, Select } from '@/components/ui';
import { ROLE_OPTIONS } from './roles';
const props = defineProps<{ open: boolean; user?: PublicUser | null; teams: TeamSummary[] }>();
const emit = defineEmits<{ 'update:open': [v: boolean]; saved: [u: PublicUser] }>();
const { toast } = useToast();
const schema = toTypedSchema(z.object({
  firstName: z.string().trim().min(1, 'Enter a first name').max(60), lastName: z.string().trim().min(1, 'Enter a last name').max(60), email: z.string().trim().email('Enter a valid email'),
  role: z.enum(['employee', 'tech_lead', 'delivery_manager', 'cto', 'finance', 'admin']), teamId: z.string().nullable(), employeeCode: z.string().trim().max(20).nullable(), timezone: z.string().trim().min(1, 'Enter a timezone').max(64),
}));
const { handleSubmit, defineField, errors, setErrors, resetForm, isSubmitting, meta } = useForm({ validationSchema: schema });
const [firstName] = defineField('firstName'); const [lastName] = defineField('lastName'); const [email] = defineField('email'); const [role] = defineField('role'); const [teamId] = defineField('teamId'); const [employeeCode] = defineField('employeeCode'); const [timezone] = defineField('timezone');
const formError = ref('');
const teamOptions = computed(() => [{ value: 'none', label: 'No team' }, ...props.teams.map((t) => ({ value: t.id, label: t.name }))]);
watch(() => props.open, (o) => { if (!o) return; formError.value = ''; const u = props.user;
  resetForm({ values: u ? { firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, teamId: u.teamId, employeeCode: u.employeeCode, timezone: u.timezone } : { firstName: '', lastName: '', email: '', role: 'employee' as UserRole, teamId: null, employeeCode: null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }); }, { immediate: true });
const submit = handleSubmit(async (v) => {
  formError.value = '';
  try {
    const body = { ...v, employeeCode: v.employeeCode || null };
    const saved = props.user ? await usersApi.update(props.user.id, { firstName: body.firstName, lastName: body.lastName, role: body.role, teamId: body.teamId, employeeCode: body.employeeCode, timezone: body.timezone }) : await usersApi.create(body);
    toast({ title: props.user ? 'User updated' : 'Invite sent', tone: 'success' }); emit('saved', saved); emit('update:open', false);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'EMAIL_TAKEN') setErrors({ email: messageFor(e) });
    else if (e instanceof ApiError && e.code === 'EMPLOYEE_CODE_TAKEN') setErrors({ employeeCode: messageFor(e) });
    else { setErrors(fieldErrors(e)); formError.value = messageFor(e); }
  }
});
function beforeClose(e: Event) { if (meta.value.dirty && !confirm('Discard unsaved changes?')) e.preventDefault(); }
</script>
<template>
  <Drawer :open="open" :title="user ? 'Edit user' : 'Invite user'" :description="user ? undefined : 'They receive an email with a link to set their password.'" @update:open="emit('update:open', $event)" @before-close="beforeClose">
    <form id="user-form" class="space-y-4" novalidate @submit.prevent="submit">
      <p v-if="formError" role="alert" class="rounded-control border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{{ formError }}</p>
      <div class="grid grid-cols-2 gap-3">
        <FormField label="First name" name="firstName" :error="errors.firstName" required><template #default="{ id, invalid }"><Input :id="id" v-model="firstName" name="firstName" :invalid="invalid" /></template></FormField>
        <FormField label="Last name" name="lastName" :error="errors.lastName" required><template #default="{ id, invalid }"><Input :id="id" v-model="lastName" name="lastName" :invalid="invalid" /></template></FormField>
      </div>
      <FormField label="Email" name="email" :error="errors.email" required><template #default="{ id, invalid }"><Input :id="id" v-model="email" name="email" type="email" :readonly="Boolean(user)" :invalid="invalid" /></template></FormField>
      <FormField label="Role" name="role" :error="errors.role" required><template #default="{ id, invalid }"><Select :id="id" v-model="role" :options="ROLE_OPTIONS" :invalid="invalid" /></template></FormField>
      <FormField label="Team" name="teamId" :error="errors.teamId" hint="Admins, finance and the CTO usually have no team"><template #default="{ id }"><Select :id="id" :model-value="teamId ?? 'none'" :options="teamOptions" @update:model-value="teamId = $event === 'none' ? null : $event" /></template></FormField>
      <FormField label="Employee code" name="employeeCode" :error="errors.employeeCode"><template #default="{ id, invalid }"><Input :id="id" :model-value="employeeCode ?? ''" name="employeeCode" mono :invalid="invalid" @update:model-value="employeeCode = $event" /></template></FormField>
      <FormField label="Timezone" name="timezone" :error="errors.timezone" hint="IANA name, e.g. Asia/Riyadh" required><template #default="{ id, invalid }"><Input :id="id" v-model="timezone" name="timezone" :invalid="invalid" /></template></FormField>
    </form>
    <template #footer><Button variant="outline" @click="emit('update:open', false)">Cancel</Button><Button type="submit" form="user-form" :loading="isSubmitting">{{ user ? 'Save changes' : 'Send invite' }}</Button></template>
  </Drawer>
</template>
```

`src/features/admin/UsersPage.vue`:
```vue
<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import type { ColumnDef } from '@tanstack/vue-table';
import { useDebounceFn } from '@vueuse/core';
import { MoreHorizontal, Pencil, Mail, UserX, UserCheck } from 'lucide-vue-next';
import { usersApi } from '@/api/users.api';
import { teamsApi } from '@/api/teams.api';
import type { PublicUser } from '@/api/types';
import { fullName } from '@/lib/format';
import { messageFor } from '@/api/errors';
import { useToast } from '@/components/ui/useToast';
import { PageHeader, Button, Input, Select, FormField, DataTable, Pagination, Badge, DropdownMenu, ConfirmDialog } from '@/components/ui';
import { ROLE_OPTIONS, roleLabel } from './roles';
import UserFormDrawer from './UserFormDrawer.vue';
const qc = useQueryClient(); const { toast } = useToast();
const search = ref(''); const debounced = ref(''); const role = ref('all'); const active = ref('true'); const page = ref(1);
const setSearch = useDebounceFn((v: string) => { debounced.value = v; page.value = 1; }, 300);
watch(search, setSearch); watch([role, active], () => { page.value = 1; });
const params = computed(() => ({ search: debounced.value || undefined, role: role.value === 'all' ? undefined : role.value, isActive: active.value === 'all' ? undefined : (active.value as 'true' | 'false'), page: page.value }));
const q = useQuery({ queryKey: ['users', params], queryFn: () => usersApi.list(params.value) });
const teams = useQuery({ queryKey: ['teams', 'all'], queryFn: () => teamsApi.list({ pageSize: 100 }) });
const teamName = (id: string | null) => teams.data.value?.data.find((t) => t.id === id)?.name ?? '—';
const drawerOpen = ref(false); const editing = ref<PublicUser | null>(null); const toggling = ref<PublicUser | null>(null); const toggleLoading = ref(false);
const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });
async function resend(u: PublicUser) { try { await usersApi.resendInvite(u.id); toast({ title: `Invite sent to ${u.email}`, tone: 'success' }); } catch (e) { toast({ title: messageFor(e), tone: 'error' }); } }
async function confirmToggle() {
  const u = toggling.value!; toggleLoading.value = true;
  try { await (u.isActive ? usersApi.deactivate(u.id) : usersApi.reactivate(u.id)); toast({ title: u.isActive ? 'User deactivated' : 'User reactivated', tone: 'success' }); toggling.value = null; await invalidate(); }
  catch (e) { toast({ title: messageFor(e), tone: 'error' }); } finally { toggleLoading.value = false; }
}
const columns: ColumnDef<PublicUser, unknown>[] = [
  { id: 'name', header: 'Name', cell: ({ row }) => h('div', [h('p', { class: 'font-medium' }, fullName(row.original)), h('p', { class: 'text-sm text-muted-foreground' }, row.original.email)]) },
  { accessorKey: 'employeeCode', header: 'Code', cell: ({ row }) => h('span', { class: 'num' }, row.original.employeeCode ?? '—') },
  { accessorKey: 'role', header: 'Role', cell: ({ row }) => h(Badge, { tone: row.original.role === 'admin' ? 'indigo' : 'neutral' }, () => roleLabel(row.original.role)) },
  { id: 'team', header: 'Team', cell: ({ row }) => teamName(row.original.teamId) },
  { accessorKey: 'isActive', header: 'Status', cell: ({ row }) => h(Badge, { tone: row.original.isActive ? 'success' : 'danger' }, () => (row.original.isActive ? 'Active' : 'Inactive')) },
  { id: 'actions', header: '', cell: ({ row }) => h(DropdownMenu, { items: [
      { label: 'Edit', icon: Pencil, onSelect: () => { editing.value = row.original; drawerOpen.value = true; } },
      { label: 'Resend invite', icon: Mail, onSelect: () => resend(row.original) },
      row.original.isActive ? { label: 'Deactivate', icon: UserX, destructive: true, onSelect: () => { toggling.value = row.original; } } : { label: 'Reactivate', icon: UserCheck, onSelect: () => { toggling.value = row.original; } },
    ] }, { trigger: () => h(Button, { variant: 'ghost', size: 'sm', 'aria-label': 'Actions' }, () => h(MoreHorizontal, { class: 'h-4 w-4' })) }) },
];
</script>
<template>
  <PageHeader title="Users" description="Invite people, assign roles and teams, deactivate leavers."><template #actions><Button @click="editing = null; drawerOpen = true">Invite user</Button></template></PageHeader>
  <div class="mb-4 grid gap-4 sm:grid-cols-3">
    <FormField label="Search" name="search"><template #default="{ id }"><Input :id="id" v-model="search" type="search" placeholder="Name or email" /></template></FormField>
    <FormField label="Role" name="role"><template #default="{ id }"><Select :id="id" v-model="role" :options="[{ value: 'all', label: 'All roles' }, ...ROLE_OPTIONS]" /></template></FormField>
    <FormField label="Status" name="active"><template #default="{ id }"><Select :id="id" v-model="active" :options="[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }, { value: 'all', label: 'All' }]" /></template></FormField>
  </div>
  <DataTable :columns="columns" :rows="q.data.value?.data ?? []" :row-key="(u) => u.id" :loading="q.isPending.value" :error="q.isError.value ? messageFor(q.error.value) : null" empty-title="No users match" @retry="q.refetch()" />
  <Pagination v-if="q.data.value" :page="page" :page-size="q.data.value.meta.pageSize" :total="q.data.value.meta.total" @update:page="page = $event" />
  <UserFormDrawer v-model:open="drawerOpen" :user="editing" :teams="teams.data.value?.data ?? []" @saved="invalidate()" />
  <ConfirmDialog :open="Boolean(toggling)" :title="toggling?.isActive ? 'Deactivate this user?' : 'Reactivate this user?'" :description="toggling ? `${fullName(toggling)} · ${toggling.email}${toggling.isActive ? '. They will no longer be able to sign in. Sheets and decisions are kept.' : ''}` : ''" :confirm-label="toggling?.isActive ? 'Deactivate' : 'Reactivate'" :destructive="toggling?.isActive" :loading="toggleLoading" @update:open="(v) => !v && (toggling = null)" @confirm="confirmToggle" />
</template>
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add admin users page with invite, edit, deactivate and resend invite"
```

---

### Task 16: Admin teams page and chain editor

**Files:**
- Create: `src/api/chains.api.ts`, `src/features/admin/TeamsPage.vue`, `TeamFormDrawer.vue`, `ChainEditorPage.vue`, `ChainEditorPage.spec.ts`

**Interfaces:**
- `chainsApi.get(teamId) → ChainStepView[]`, `replace(teamId, steps: Array<{ label; approverId; backupApproverId?: string | null }>) → ChainStepView[]`.
- `TeamsPage`: table (name, tech lead, members, chain steps with a warning badge when 0 or when any approver is inactive, active) + "New team" → `TeamFormDrawer` (name, description, tech lead Combobox from active users, active switch in edit) + "Chain" link per row to `admin-chain`.
- `ChainEditorPage` (`/admin/teams/:id/chain`): loads team + chain + active users; local ordered list of steps `{ key, label, approverId, backupApproverId }`; add step, remove step, move up/down buttons (keyboard-friendly reorder; no drag library), label Input, approver Combobox (required), backup Combobox (optional, must differ from approver); banner "This team has no chain; sheets cannot be submitted" when empty; Save calls `chainsApi.replace`; "Discard" resets to server state; unsaved-changes guard on route leave (`onBeforeRouteLeave`).

- [ ] **Step 1: Write failing test**

`src/features/admin/ChainEditorPage.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import ChainEditorPage from './ChainEditorPage.vue';
const replace = vi.fn(async (_t: string, steps: unknown[]) => steps.map((s, i) => ({ id: String(i), position: i + 1, ...(s as object), approver: { id: 'u1', firstName: 'A', lastName: 'B', isActive: true }, backupApprover: null })));
vi.mock('@/api/chains.api', () => ({ chainsApi: { get: vi.fn(async () => []), replace: (...a: unknown[]) => replace(...(a as [string, unknown[]])) } }));
vi.mock('@/api/teams.api', () => ({ teamsApi: { get: vi.fn(async () => ({ id: 't1', name: 'Platform' })) } }));
vi.mock('@/api/users.api', () => ({ usersApi: { list: vi.fn(async () => ({ data: [{ id: 'u1', firstName: 'A', lastName: 'B', isActive: true }, { id: 'u2', firstName: 'C', lastName: 'D', isActive: true }], meta: { page: 1, pageSize: 100, total: 2 } })) } }));
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn(), useRouter: () => ({ push: vi.fn() }), RouterLink: { template: '<a><slot/></a>' } }));
describe('ChainEditorPage', () => {
  it('starts empty with a warning, adds a step, validates approver, moves steps, saves in order', async () => {
    const w = mount(ChainEditorPage, { props: { id: 't1' }, global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
    await flushPromises();
    expect(w.text()).toContain('no approval chain');
    await w.find('[data-action="add-step"]').trigger('click'); await w.find('[data-action="add-step"]').trigger('click');
    const vm = w.vm as unknown as { steps: Array<{ label: string; approverId: string | null }> };
    vm.steps[0].label = 'TL'; vm.steps[0].approverId = 'u1'; vm.steps[1].label = 'CTO'; vm.steps[1].approverId = 'u2';
    await flushPromises();
    await w.findAll('[data-action="move-up"]')[1].trigger('click');
    await w.find('[data-action="save"]').trigger('click'); await flushPromises();
    expect(replace).toHaveBeenCalledWith('t1', [{ label: 'CTO', approverId: 'u2', backupApproverId: null }, { label: 'TL', approverId: 'u1', backupApproverId: null }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`src/api/chains.api.ts`:
```ts
import { get, put } from './client';
import type { ChainStepView } from './types';
export const chainsApi = {
  get: (teamId: string) => get<{ data: ChainStepView[] }>(`/teams/${teamId}/chain`).then((r) => r.data),
  replace: (teamId: string, steps: Array<{ label: string; approverId: string; backupApproverId?: string | null }>) => put<{ data: ChainStepView[] }>(`/teams/${teamId}/chain`, { steps }).then((r) => r.data),
};
```

`src/features/admin/ChainEditorPage.vue`:
```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onBeforeRouteLeave, RouterLink } from 'vue-router';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { Plus, Trash2, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-vue-next';
import { chainsApi } from '@/api/chains.api';
import { teamsApi } from '@/api/teams.api';
import { usersApi } from '@/api/users.api';
import type { ChainStepView } from '@/api/types';
import { fullName } from '@/lib/format';
import { messageFor } from '@/api/errors';
import { useToast } from '@/components/ui/useToast';
import { PageHeader, Button, Card, Input, Combobox, FormField, Skeleton } from '@/components/ui';
const props = defineProps<{ id: string }>();
const qc = useQueryClient(); const { toast } = useToast();
const team = useQuery({ queryKey: ['team', props.id], queryFn: () => teamsApi.get(props.id) });
const chain = useQuery({ queryKey: ['chain', props.id], queryFn: () => chainsApi.get(props.id) });
const users = useQuery({ queryKey: ['users', 'pickers'], queryFn: () => usersApi.list({ isActive: 'true', pageSize: 100 }) });
const people = computed(() => (users.data.value?.data ?? []).map((u) => ({ value: u.id, label: fullName(u) })));
interface Step { key: number; label: string; approverId: string | null; backupApproverId: string | null }
let seq = 0;
const steps = ref<Step[]>([]); const errors = ref<Record<number, string>>({}); const saving = ref(false);
const fromServer = (s: ChainStepView[]) => s.map((x) => ({ key: ++seq, label: x.label, approverId: x.approver.id, backupApproverId: x.backupApprover?.id ?? null }));
watch(() => chain.data.value, (d) => { if (d) steps.value = fromServer(d); }, { immediate: true });
const dirty = computed(() => JSON.stringify(steps.value.map(({ key: _k, ...s }) => s)) !== JSON.stringify(fromServer(chain.data.value ?? []).map(({ key: _k, ...s }) => s)));
function add() { steps.value.push({ key: ++seq, label: ['Tech Lead', 'Delivery Manager', 'CTO'][steps.value.length] ?? '', approverId: null, backupApproverId: null }); }
function remove(i: number) { steps.value.splice(i, 1); }
function move(i: number, d: -1 | 1) { const j = i + d; if (j < 0 || j >= steps.value.length) return; const a = steps.value; [a[i], a[j]] = [a[j], a[i]]; }
function validate() {
  errors.value = {};
  steps.value.forEach((s) => { if (!s.label.trim()) errors.value[s.key] = 'Give this step a label'; else if (!s.approverId) errors.value[s.key] = 'Pick an approver'; else if (s.backupApproverId === s.approverId) errors.value[s.key] = 'Backup must differ from the approver'; });
  return Object.keys(errors.value).length === 0;
}
async function save() {
  if (!validate()) return; saving.value = true;
  try { const r = await chainsApi.replace(props.id, steps.value.map((s) => ({ label: s.label.trim(), approverId: s.approverId!, backupApproverId: s.backupApproverId }))); qc.setQueryData(['chain', props.id], r); qc.invalidateQueries({ queryKey: ['teams'] }); toast({ title: 'Chain saved', tone: 'success' }); }
  catch (e) { toast({ title: messageFor(e), tone: 'error' }); } finally { saving.value = false; }
}
function discard() { steps.value = fromServer(chain.data.value ?? []); errors.value = {}; }
onBeforeRouteLeave(() => (dirty.value ? confirm('Discard unsaved chain changes?') : true));
defineExpose({ steps });
</script>
<template>
  <PageHeader :title="team.data.value ? `${team.data.value.name} · approval chain` : 'Approval chain'" description="Sheets go through these steps in order. Each step needs one approver; a backup can act in their place.">
    <template #actions><RouterLink :to="{ name: 'admin-teams' }"><Button variant="ghost">Back to teams</Button></RouterLink><Button variant="outline" :disabled="!dirty || saving" @click="discard">Discard</Button><Button data-action="save" :loading="saving" :disabled="!dirty" @click="save">Save chain</Button></template>
  </PageHeader>
  <Skeleton v-if="chain.isPending.value" :lines="4" />
  <template v-else>
    <p v-if="steps.length === 0" role="alert" class="mb-4 flex items-center gap-2 rounded-card border border-warning/40 bg-warning/10 px-4 py-3 text-sm"><AlertTriangle class="h-4 w-4 text-warning" />This team has no approval chain. Members cannot submit sheets until at least one step exists.</p>
    <div class="space-y-3">
      <Card v-for="(s, i) in steps" :key="s.key">
        <div class="grid gap-3 md:grid-cols-[auto_1fr_1fr_1fr_auto] md:items-end">
          <p class="num text-xl font-semibold text-muted-foreground md:pb-2">{{ i + 1 }}</p>
          <FormField label="Label" :name="`label-${s.key}`" :error="errors[s.key]" required><template #default="{ id, invalid }"><Input :id="id" v-model="s.label" :invalid="invalid" placeholder="Tech Lead" /></template></FormField>
          <FormField label="Approver" :name="`approver-${s.key}`" required><template #default="{ id }"><Combobox :id="id" v-model="s.approverId" :options="people" placeholder="Search people" /></template></FormField>
          <FormField label="Backup (optional)" :name="`backup-${s.key}`"><template #default="{ id }"><Combobox :id="id" v-model="s.backupApproverId" :options="people" placeholder="Search people" /></template></FormField>
          <div class="flex gap-1 md:pb-1">
            <Button variant="ghost" size="sm" data-action="move-up" aria-label="Move up" :disabled="i === 0" @click="move(i, -1)"><ArrowUp class="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" data-action="move-down" aria-label="Move down" :disabled="i === steps.length - 1" @click="move(i, 1)"><ArrowDown class="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" aria-label="Remove step" @click="remove(i)"><Trash2 class="h-4 w-4 text-destructive" /></Button>
          </div>
        </div>
      </Card>
      <Button variant="outline" data-action="add-step" :disabled="steps.length >= 10" @click="add"><Plus class="h-4 w-4" />Add step</Button>
    </div>
  </template>
</template>
```

`src/features/admin/TeamFormDrawer.vue`:
```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useForm } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/vue-query';
import type { TeamSummary } from '@/api/types';
import { teamsApi } from '@/api/teams.api';
import { usersApi } from '@/api/users.api';
import { ApiError, messageFor, fieldErrors } from '@/api/errors';
import { fullName } from '@/lib/format';
import { useToast } from '@/components/ui/useToast';
import { Drawer, Button, FormField, Input, Textarea, Combobox, Switch } from '@/components/ui';
const props = defineProps<{ open: boolean; team?: TeamSummary | null }>();
const emit = defineEmits<{ 'update:open': [v: boolean]; saved: [t: TeamSummary] }>();
const { toast } = useToast();
const users = useQuery({ queryKey: ['users', 'pickers'], queryFn: () => usersApi.list({ isActive: 'true', pageSize: 100 }) });
const people = computed(() => (users.data.value?.data ?? []).map((u) => ({ value: u.id, label: fullName(u) })));
const { handleSubmit, defineField, errors, setErrors, resetForm, isSubmitting } = useForm({ validationSchema: toTypedSchema(z.object({ name: z.string().trim().min(1, 'Enter a team name').max(80), description: z.string().trim().max(500).nullable(), techLeadId: z.string().nullable(), isActive: z.boolean() })) });
const [name] = defineField('name'); const [description] = defineField('description'); const [techLeadId] = defineField('techLeadId'); const [isActive] = defineField('isActive'); const formError = ref('');
watch(() => props.open, (o) => { if (o) { formError.value = ''; const t = props.team; resetForm({ values: t ? { name: t.name, description: t.description, techLeadId: t.techLead?.id ?? null, isActive: t.isActive } : { name: '', description: null, techLeadId: null, isActive: true } }); } }, { immediate: true });
const submit = handleSubmit(async (v) => {
  formError.value = '';
  try { const saved = props.team ? await teamsApi.update(props.team.id, v) : await teamsApi.create({ name: v.name, description: v.description, techLeadId: v.techLeadId }); toast({ title: props.team ? 'Team updated' : 'Team created', tone: 'success' }); emit('saved', saved); emit('update:open', false); }
  catch (e) { if (e instanceof ApiError && e.code === 'TEAM_NAME_TAKEN') setErrors({ name: messageFor(e) }); else { setErrors(fieldErrors(e)); formError.value = messageFor(e); } }
});
</script>
<template>
  <Drawer :open="open" :title="team ? 'Edit team' : 'New team'" @update:open="emit('update:open', $event)">
    <form id="team-form" class="space-y-4" novalidate @submit.prevent="submit">
      <p v-if="formError" role="alert" class="text-sm text-destructive">{{ formError }}</p>
      <FormField label="Name" name="name" :error="errors.name" required><template #default="{ id, invalid }"><Input :id="id" v-model="name" :invalid="invalid" /></template></FormField>
      <FormField label="Description" name="description" :error="errors.description"><template #default="{ id, invalid }"><Textarea :id="id" :model-value="description ?? ''" :invalid="invalid" @update:model-value="description = $event || null" /></template></FormField>
      <FormField label="Tech lead" name="techLeadId" hint="Can see the team month view"><template #default="{ id }"><Combobox :id="id" v-model="techLeadId" :options="people" placeholder="Search people" /></template></FormField>
      <Switch v-if="team" v-model="isActive" label="Team is active" />
    </form>
    <template #footer><Button variant="outline" @click="emit('update:open', false)">Cancel</Button><Button type="submit" form="team-form" :loading="isSubmitting">{{ team ? 'Save changes' : 'Create team' }}</Button></template>
  </Drawer>
</template>
```

`src/features/admin/TeamsPage.vue`:
```vue
<script setup lang="ts">
import { h, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import type { ColumnDef } from '@tanstack/vue-table';
import { AlertTriangle, Pencil, Network } from 'lucide-vue-next';
import { teamsApi } from '@/api/teams.api';
import type { TeamSummary } from '@/api/types';
import { fullName } from '@/lib/format';
import { messageFor } from '@/api/errors';
import { PageHeader, Button, DataTable, Pagination, Badge } from '@/components/ui';
import TeamFormDrawer from './TeamFormDrawer.vue';
const qc = useQueryClient(); const page = ref(1);
const q = useQuery({ queryKey: ['teams', page], queryFn: () => teamsApi.list({ page: page.value }) });
const open = ref(false); const editing = ref<TeamSummary | null>(null);
const columns: ColumnDef<TeamSummary, unknown>[] = [
  { accessorKey: 'name', header: 'Team', cell: ({ row }) => h('div', [h('p', { class: 'font-medium' }, row.original.name), h('p', { class: 'text-sm text-muted-foreground' }, row.original.description ?? '')]) },
  { id: 'lead', header: 'Tech lead', cell: ({ row }) => (row.original.techLead ? fullName(row.original.techLead) : '—') },
  { accessorKey: 'memberCount', header: 'Members', meta: { numeric: true } },
  { id: 'chain', header: 'Chain', cell: ({ row }) => row.original.chainStepCount === 0 ? h(Badge, { tone: 'warning' }, () => [h(AlertTriangle, { class: 'h-4 w-4' }), 'No chain']) : h('span', { class: 'num' }, `${row.original.chainStepCount} steps`) },
  { accessorKey: 'isActive', header: 'Status', cell: ({ row }) => h(Badge, { tone: row.original.isActive ? 'success' : 'neutral' }, () => (row.original.isActive ? 'Active' : 'Inactive')) },
  { id: 'actions', header: '', cell: ({ row }) => h('div', { class: 'flex justify-end gap-1' }, [
      h(RouterLink, { to: { name: 'admin-chain', params: { id: row.original.id } } }, () => h(Button, { variant: 'ghost', size: 'sm' }, () => [h(Network, { class: 'h-4 w-4' }), 'Chain'])),
      h(Button, { variant: 'ghost', size: 'sm', 'aria-label': 'Edit team', onClick: () => { editing.value = row.original; open.value = true; } }, () => h(Pencil, { class: 'h-4 w-4' })),
    ]) },
];
</script>
<template>
  <PageHeader title="Teams" description="Each team has a tech lead and its own approval chain."><template #actions><Button @click="editing = null; open = true">New team</Button></template></PageHeader>
  <DataTable :columns="columns" :rows="q.data.value?.data ?? []" :row-key="(t) => t.id" :loading="q.isPending.value" :error="q.isError.value ? messageFor(q.error.value) : null" empty-title="No teams yet" @retry="q.refetch()" />
  <Pagination v-if="q.data.value" :page="page" :page-size="q.data.value.meta.pageSize" :total="q.data.value.meta.total" @update:page="page = $event" />
  <TeamFormDrawer v-model:open="open" :team="editing" @saved="qc.invalidateQueries({ queryKey: ['teams'] })" />
</template>
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add admin teams page and keyboard-friendly approval chain editor"
```

---

### Task 17: Admin overtime types and audit log pages

**Files:**
- Create: `src/api/audit.api.ts`, `src/features/admin/OvertimeTypesPage.vue`, `OvertimeTypesPage.spec.ts`, `AuditLogPage.vue`

**Interfaces:**
- `auditApi.list(q: { entityType?; entityId?; actorId?; from?; to?; page? }) → Paged<AuditRow>`.
- `OvertimeTypesPage`: table rows with inline editing: name Input, multiplier number Input (step 0.01, > 0), color input, active Switch; a Save button per row enabled when dirty; "Add type" row at the bottom. Changing a multiplier shows a hint "Applies to future submissions only".
- `AuditLogPage`: filters entity type Select, entity id Input, from/to DatePickers; table: when, actor, action, entity, reason; expandable row shows a two-column before/after `<pre>` JSON.

- [ ] **Step 1: Write failing test**

`src/features/admin/OvertimeTypesPage.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import OvertimeTypesPage from './OvertimeTypesPage.vue';
const update = vi.fn(async (id: string, b: unknown) => ({ id, ...(b as object) }));
vi.mock('@/api/overtime-types.api', () => ({ overtimeTypesApi: { list: vi.fn(async () => [{ id: 't1', name: 'Weekend', multiplier: 2, color: '#000000', sortOrder: 1, isActive: true }]), update: (...a: unknown[]) => update(...(a as [string, unknown])), create: vi.fn() } }));
describe('OvertimeTypesPage', () => {
  it('enables Save when a multiplier changes and sends the patch', async () => {
    const w = mount(OvertimeTypesPage, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
    await flushPromises();
    const save = w.find('[data-action="save-t1"]'); expect(save.attributes('disabled')).toBeDefined();
    await w.find('input[name="multiplier-t1"]').setValue('2.25');
    expect(w.find('[data-action="save-t1"]').attributes('disabled')).toBeUndefined();
    await w.find('[data-action="save-t1"]').trigger('click'); await flushPromises();
    expect(update).toHaveBeenCalledWith('t1', expect.objectContaining({ multiplier: 2.25 }));
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`src/api/audit.api.ts`:
```ts
import { get } from './client';
import type { Paged, AuditRow } from './types';
export const auditApi = { list: (q: { entityType?: string; entityId?: string; actorId?: string; from?: string; to?: string; page?: number } = {}) => get<Paged<AuditRow>>('/admin/audit', q) };
```

`src/features/admin/OvertimeTypesPage.vue`:
```vue
<script setup lang="ts">
import { ref, watch } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { Plus } from 'lucide-vue-next';
import { overtimeTypesApi } from '@/api/overtime-types.api';
import type { OvertimeType } from '@/api/types';
import { messageFor } from '@/api/errors';
import { useToast } from '@/components/ui/useToast';
import { PageHeader, Card, Button, Input, Switch, Skeleton } from '@/components/ui';
const qc = useQueryClient(); const { toast } = useToast();
const q = useQuery({ queryKey: ['overtime-types', 'all'], queryFn: () => overtimeTypesApi.list(true) });
type Row = OvertimeType & { saving?: boolean };
const rows = ref<Row[]>([]); const original = ref<Record<string, OvertimeType>>({});
watch(() => q.data.value, (d) => { if (d) { rows.value = d.map((t) => ({ ...t })); original.value = Object.fromEntries(d.map((t) => [t.id, t])); } }, { immediate: true });
const dirty = (r: Row) => { const o = original.value[r.id]; return !o || o.name !== r.name || o.multiplier !== r.multiplier || o.color !== r.color || o.isActive !== r.isActive; };
const valid = (r: Row) => r.name.trim().length > 0 && r.multiplier > 0 && /^#[0-9A-Fa-f]{6}$/.test(r.color);
async function save(r: Row) {
  r.saving = true;
  try { await overtimeTypesApi.update(r.id, { name: r.name.trim(), multiplier: r.multiplier, color: r.color, isActive: r.isActive }); toast({ title: 'Overtime type saved', tone: 'success' }); await qc.invalidateQueries({ queryKey: ['overtime-types'] }); }
  catch (e) { toast({ title: messageFor(e), tone: 'error' }); } finally { r.saving = false; }
}
const draft = ref<{ name: string; multiplier: number; color: string } | null>(null); const creating = ref(false);
async function create() {
  if (!draft.value || !draft.value.name.trim() || draft.value.multiplier <= 0) return; creating.value = true;
  try { await overtimeTypesApi.create({ name: draft.value.name.trim(), multiplier: draft.value.multiplier, color: draft.value.color, sortOrder: rows.value.length + 1 }); draft.value = null; toast({ title: 'Overtime type added', tone: 'success' }); await qc.invalidateQueries({ queryKey: ['overtime-types'] }); }
  catch (e) { toast({ title: messageFor(e), tone: 'error' }); } finally { creating.value = false; }
}
</script>
<template>
  <PageHeader title="Overtime types" description="Each type has a multiplier. Changing a multiplier affects future submissions only; submitted sheets keep their snapshot.">
    <template #actions><Button :disabled="Boolean(draft)" @click="draft = { name: '', multiplier: 1.5, color: '#2563EB' }"><Plus class="h-4 w-4" />Add type</Button></template>
  </PageHeader>
  <Skeleton v-if="q.isPending.value" :lines="4" />
  <div v-else class="space-y-3">
    <Card v-for="r in rows" :key="r.id">
      <div class="grid gap-3 md:grid-cols-[1fr_140px_120px_auto_auto] md:items-center">
        <Input v-model="r.name" :aria-label="`Name of ${r.name}`" />
        <Input :model-value="r.multiplier" :name="`multiplier-${r.id}`" type="number" step="0.01" min="0.01" mono aria-label="Multiplier" @update:model-value="r.multiplier = Number($event)" />
        <label class="flex items-center gap-2 text-sm"><input v-model="r.color" type="color" class="h-11 w-11 cursor-pointer rounded-control border bg-surface" aria-label="Color" /><span class="num">{{ r.color }}</span></label>
        <Switch v-model="r.isActive" label="Active" />
        <Button :data-action="`save-${r.id}`" size="sm" :disabled="!dirty(r) || !valid(r)" :loading="r.saving" @click="save(r)">Save</Button>
      </div>
    </Card>
    <Card v-if="draft">
      <div class="grid gap-3 md:grid-cols-[1fr_140px_120px_auto_auto] md:items-center">
        <Input v-model="draft.name" placeholder="Night shift" aria-label="New type name" />
        <Input :model-value="draft.multiplier" type="number" step="0.01" min="0.01" mono aria-label="New multiplier" @update:model-value="draft.multiplier = Number($event)" />
        <input v-model="draft.color" type="color" class="h-11 w-11 cursor-pointer rounded-control border bg-surface" aria-label="New color" />
        <Button variant="outline" size="sm" @click="draft = null">Cancel</Button>
        <Button size="sm" :loading="creating" :disabled="!draft.name.trim() || draft.multiplier <= 0" @click="create">Add</Button>
      </div>
    </Card>
  </div>
</template>
```

`src/features/admin/AuditLogPage.vue`:
```vue
<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type { ColumnDef } from '@tanstack/vue-table';
import { auditApi } from '@/api/audit.api';
import type { AuditRow } from '@/api/types';
import { formatDateTime, fullName } from '@/lib/format';
import { messageFor } from '@/api/errors';
import { PageHeader, DataTable, Pagination, Select, Input, DatePicker, FormField, Badge } from '@/components/ui';
const entityType = ref('all'); const entityId = ref(''); const from = ref<string | null>(null); const to = ref<string | null>(null); const page = ref(1);
watch([entityType, entityId, from, to], () => { page.value = 1; });
const params = computed(() => ({ entityType: entityType.value === 'all' ? undefined : entityType.value, entityId: entityId.value.trim() || undefined, from: from.value ? `${from.value}T00:00:00.000Z` : undefined, to: to.value ? `${to.value}T23:59:59.999Z` : undefined, page: page.value }));
const q = useQuery({ queryKey: ['audit', params], queryFn: () => auditApi.list(params.value) });
const typeOptions = [{ value: 'all', label: 'All entities' }, { value: 'sheet', label: 'Sheets' }, { value: 'user', label: 'Users' }, { value: 'team', label: 'Teams' }, { value: 'chain', label: 'Chains' }, { value: 'overtime_type', label: 'Overtime types' }];
const columns: ColumnDef<AuditRow, unknown>[] = [
  { accessorKey: 'createdAt', header: 'When', cell: ({ row }) => h('span', { class: 'num text-sm' }, formatDateTime(row.original.createdAt)) },
  { id: 'actor', header: 'Actor', cell: ({ row }) => (row.original.actor ? fullName(row.original.actor) : h('span', { class: 'text-muted-foreground' }, 'System')) },
  { accessorKey: 'action', header: 'Action', cell: ({ row }) => h(Badge, { tone: row.original.action.includes('reject') || row.original.action.includes('deactivat') ? 'danger' : row.original.action.includes('paid') || row.original.action.includes('approved') ? 'success' : 'neutral' }, () => row.original.action) },
  { id: 'entity', header: 'Entity', cell: ({ row }) => h('span', { class: 'num text-sm' }, `${row.original.entityType} · ${row.original.entityId.slice(0, 8)}`) },
  { accessorKey: 'reason', header: 'Reason', cell: ({ row }) => row.original.reason ?? '' },
];
const pretty = (v: unknown) => (v === null || v === undefined ? '—' : JSON.stringify(v, null, 2));
</script>
<template>
  <PageHeader title="Audit log" description="Every sheet transition and admin configuration change." />
  <div class="mb-4 grid gap-4 sm:grid-cols-4">
    <FormField label="Entity" name="entityType"><template #default="{ id }"><Select :id="id" v-model="entityType" :options="typeOptions" /></template></FormField>
    <FormField label="Entity id" name="entityId"><template #default="{ id }"><Input :id="id" v-model="entityId" mono placeholder="uuid" /></template></FormField>
    <FormField label="From" name="from"><template #default="{ id }"><DatePicker :id="id" v-model="from" /></template></FormField>
    <FormField label="To" name="to"><template #default="{ id }"><DatePicker :id="id" v-model="to" /></template></FormField>
  </div>
  <DataTable :columns="columns" :rows="q.data.value?.data ?? []" :row-key="(r) => r.id" :loading="q.isPending.value" :error="q.isError.value ? messageFor(q.error.value) : null" empty-title="No audit entries" expandable @retry="q.refetch()">
    <template #expanded="{ row }"><div class="grid gap-4 md:grid-cols-2"><div><p class="mb-1 text-xs font-medium uppercase text-muted-foreground">Before</p><pre class="num overflow-x-auto rounded-control bg-surface p-3 text-xs">{{ pretty(row.before) }}</pre></div><div><p class="mb-1 text-xs font-medium uppercase text-muted-foreground">After</p><pre class="num overflow-x-auto rounded-control bg-surface p-3 text-xs">{{ pretty(row.after) }}</pre></div></div></template>
  </DataTable>
  <Pagination v-if="q.data.value" :page="page" :page-size="q.data.value.meta.pageSize" :total="q.data.value.meta.total" @update:page="page = $event" />
</template>
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add admin overtime types editor and audit log viewer"
```

---

### Task 18: Profile page

**Files:**
- Create: `src/features/profile/ProfilePage.vue`

**Interfaces:**
- Two cards: Profile (first name, last name, timezone; saves via `authApi.updateMe` and `auth.setUser`) and Password (current, new, confirm; `authApi.changePassword`; maps `INVALID_CREDENTIALS` to the current-password field). Theme toggle row using `ui.store`. Read-only rows for email, role, team.

- [ ] **Step 1: Implement**

`src/features/profile/ProfilePage.vue`:
```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useForm } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import { z } from 'zod';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { authApi } from '@/api/auth.api';
import { ApiError, messageFor, fieldErrors } from '@/api/errors';
import { roleLabel } from '@/features/admin/roles';
import { useToast } from '@/components/ui/useToast';
import { PageHeader, Card, Button, FormField, Input, PasswordInput, Switch } from '@/components/ui';
const auth = useAuthStore(); const ui = useUiStore(); const { toast } = useToast();
const profile = useForm({ validationSchema: toTypedSchema(z.object({ firstName: z.string().trim().min(1, 'Enter your first name').max(60), lastName: z.string().trim().min(1, 'Enter your last name').max(60), timezone: z.string().trim().min(1, 'Enter a timezone').max(64) })), initialValues: { firstName: auth.user?.firstName ?? '', lastName: auth.user?.lastName ?? '', timezone: auth.user?.timezone ?? '' } });
const [firstName] = profile.defineField('firstName'); const [lastName] = profile.defineField('lastName'); const [timezone] = profile.defineField('timezone');
const saveProfile = profile.handleSubmit(async (v) => { try { auth.setUser(await authApi.updateMe(v)); toast({ title: 'Profile saved', tone: 'success' }); } catch (e) { profile.setErrors(fieldErrors(e)); toast({ title: messageFor(e), tone: 'error' }); } });

const pw = useForm({ validationSchema: toTypedSchema(z.object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: z.string().min(10, 'At least 10 characters'), confirm: z.string() }).refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })) });
const [currentPassword] = pw.defineField('currentPassword'); const [newPassword] = pw.defineField('newPassword'); const [confirm] = pw.defineField('confirm'); const pwError = ref('');
const savePassword = pw.handleSubmit(async (v) => {
  pwError.value = '';
  try { await authApi.changePassword(v.currentPassword, v.newPassword); pw.resetForm(); toast({ title: 'Password changed', tone: 'success' }); }
  catch (e) { if (e instanceof ApiError && e.code === 'INVALID_CREDENTIALS') pw.setErrors({ currentPassword: 'Current password is incorrect' }); else pwError.value = messageFor(e); }
});
</script>
<template>
  <PageHeader title="Profile" />
  <div class="grid gap-6 lg:grid-cols-2">
    <Card><template #header><h2 class="font-semibold">Your details</h2></template>
      <dl class="mb-4 grid grid-cols-2 gap-2 text-sm"><dt class="text-muted-foreground">Email</dt><dd>{{ auth.user?.email }}</dd><dt class="text-muted-foreground">Role</dt><dd>{{ auth.user ? roleLabel(auth.user.role) : '' }}</dd><dt class="text-muted-foreground">Employee code</dt><dd class="num">{{ auth.user?.employeeCode ?? '—' }}</dd></dl>
      <form class="space-y-4" novalidate @submit.prevent="saveProfile">
        <div class="grid grid-cols-2 gap-3">
          <FormField label="First name" name="firstName" :error="profile.errors.value.firstName" required><template #default="{ id, invalid }"><Input :id="id" v-model="firstName" :invalid="invalid" /></template></FormField>
          <FormField label="Last name" name="lastName" :error="profile.errors.value.lastName" required><template #default="{ id, invalid }"><Input :id="id" v-model="lastName" :invalid="invalid" /></template></FormField>
        </div>
        <FormField label="Timezone" name="timezone" :error="profile.errors.value.timezone" hint="Used to decide which dates count as 'today' for your entries" required><template #default="{ id, invalid }"><Input :id="id" v-model="timezone" :invalid="invalid" /></template></FormField>
        <Switch :model-value="ui.theme === 'dark'" label="Dark mode" @update:model-value="ui.toggleTheme()" />
        <Button type="submit" :loading="profile.isSubmitting.value">Save profile</Button>
      </form>
    </Card>
    <Card><template #header><h2 class="font-semibold">Change password</h2></template>
      <form class="space-y-4" novalidate @submit.prevent="savePassword">
        <p v-if="pwError" role="alert" class="text-sm text-destructive">{{ pwError }}</p>
        <FormField label="Current password" name="currentPassword" :error="pw.errors.value.currentPassword" required><template #default="{ id, invalid }"><PasswordInput :id="id" v-model="currentPassword" :invalid="invalid" /></template></FormField>
        <FormField label="New password" name="newPassword" :error="pw.errors.value.newPassword" hint="At least 10 characters" required><template #default="{ id, invalid }"><PasswordInput :id="id" v-model="newPassword" autocomplete="new-password" :invalid="invalid" /></template></FormField>
        <FormField label="Confirm new password" name="confirm" :error="pw.errors.value.confirm" required><template #default="{ id, invalid }"><PasswordInput :id="id" v-model="confirm" autocomplete="new-password" :invalid="invalid" /></template></FormField>
        <Button type="submit" :loading="pw.isSubmitting.value">Change password</Button>
      </form>
    </Card>
  </div>
</template>
```

- [ ] **Step 2: Verify** — `pnpm build` passes; manual: change timezone, change password, sign in again with the new one.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add profile page with details, theme and password change"
```

---

### Task 19: Playwright flows, Dockerfile with nginx, README

**Files:**
- Create: `playwright.config.ts`, `e2e/helpers.ts`, `e2e/employee-submit.spec.ts`, `e2e/approver-decide.spec.ts`, `e2e/finance-pay.spec.ts`, `Dockerfile`, `nginx.conf`, `.dockerignore`, `README.md`

**Interfaces:**
- e2e runs against a live API seeded with `pnpm seed` (API repo) and `pnpm dev` of this app; `PLAYWRIGHT_BASE_URL` default `http://localhost:5173`.
- Docker image serves `dist/` with nginx on port 80, proxies `/api/` to `http://api:3000/api/`, SPA fallback to `index.html`.

- [ ] **Step 1: Playwright config and helpers**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', timeout: 60_000, retries: 0, outputDir: 'e2e-results',
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['iPhone 13'] } }],
  webServer: process.env.CI ? undefined : { command: 'pnpm dev', url: 'http://localhost:5173', reuseExistingServer: true },
});
```

`e2e/helpers.ts`:
```ts
import { Page, expect } from '@playwright/test';
export const PASSWORD = 'Password123!';
export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
}
export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/login/);
}
```

- [ ] **Step 2: Write the three flows**

`e2e/employee-submit.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';
test('employee adds an entry to the current month and submits', async ({ page }) => {
  await login(page, 'emp1.platform@overtrack.local');
  await page.getByRole('button', { name: 'Add overtime' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Add entry' }).first().click();
  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel('Date').fill(today);
  await page.getByLabel('Start').fill('18:00');
  await page.getByLabel('End').fill('20:00');
  await page.getByLabel('Overtime type').click();
  await page.getByRole('option').first().click();
  await page.getByLabel('Work item', { exact: true }).fill('E2E-1');
  await page.getByLabel('What did you do?').fill('Playwright end-to-end overtime entry');
  await page.getByRole('button', { name: 'Add entry' }).last().click();
  await expect(page.getByText('Entry added')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: /Submit for approval/ }).click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText('Sheet submitted')).toBeVisible();
  await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
});
```

`e2e/approver-decide.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';
test('tech lead approves from the inbox, delivery manager sees it next', async ({ page }) => {
  await login(page, 'tl.platform@overtrack.local');
  await page.getByRole('link', { name: 'Inbox' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Platform' }).first();
  await row.click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByLabel('Comment (optional)').fill('Looks good');
  await page.getByRole('button', { name: 'Approve', exact: true }).last().click();
  await expect(page.getByText('Sheet approved')).toBeVisible();
});
test('rejecting requires a reason', async ({ page }) => {
  await login(page, 'cto@overtrack.local');
  await page.goto('/approvals?scope=waiting');
  const row = page.getByRole('row').filter({ hasText: 'Mobile' }).first();
  await row.click();
  await page.getByRole('button', { name: 'Reject' }).click();
  await page.getByRole('button', { name: 'Reject', exact: true }).last().click();
  await expect(page.getByText(/at least 5 characters/)).toBeVisible();
});
```

`e2e/finance-pay.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';
test('finance marks an approved sheet paid and downloads the export', async ({ page }) => {
  await login(page, 'finance@overtrack.local');
  await page.getByRole('link', { name: 'Payments' }).click();
  await page.getByRole('checkbox', { name: 'Select all' }).check();
  await page.getByRole('button', { name: /Mark paid \(/ }).click();
  await page.getByLabel('Payment reference').fill('E2E-BATCH');
  await page.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await expect(page.getByText(/Marked \d+ paid/)).toBeVisible();
  await page.getByRole('tab', { name: 'Paid' }).click();
  await expect(page.getByText('E2E-BATCH')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/overtrack-.*\.csv/);
});
```
Run against a freshly seeded API: `pnpm e2e` → 4 tests PASS on chromium and mobile. (Re-seed between runs: truncate the API database and `pnpm seed`.)

- [ ] **Step 3: Docker**

`nginx.conf`:
```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  location /api/ { proxy_pass http://api:3000/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; client_max_body_size 6m; }
  location / { try_files $uri $uri/ /index.html; }
  location ~* \.(js|css|woff2|svg|png)$ { expires 30d; add_header Cache-Control "public, immutable"; }
}
```

`Dockerfile`:
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

`.dockerignore`: `node_modules`, `dist`, `e2e-results`, `playwright-report`, `.env`.

`README.md`:
```markdown
# over-track-web

## Run locally
cp .env.example .env            # VITE_API_URL=http://localhost:3000/api/v1
pnpm install && pnpm dev        # http://localhost:5173  (API must be running and seeded)

## Test
pnpm test                       # unit (Vitest)
pnpm e2e                        # Playwright against a seeded API

## Build / Docker
pnpm build
docker build -t over-track-web .   # served by nginx, /api proxied to the api service (see over-track-api/docker-compose.prod.yml)
```

- [ ] **Step 4: Verify** — `docker build -t over-track-web .` exits 0; `pnpm lint && pnpm test && pnpm build` all pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Playwright flows, nginx Dockerfile and README"
```

---

## Self-review notes

- Spec 6.1 stack: Task 1 (Vite, Vue, Router, Pinia, Query, Tailwind v4, Reka, Lucide, VeeValidate+Zod, TanStack Table, date-fns, Vitest, Playwright). Deviation on openapi-typescript stated in the header.
- Spec 6.2 structure: matches the File structure section; every listed component appears in Tasks 2–4; every feature folder in Tasks 7–18.
- Spec 6.3 design system: tokens Task 1; Fira fonts in `index.html` + `@theme`; status badge mapping Task 2; icons Lucide throughout; radius/shadow tokens Task 1.
- Spec 6.4 layout and navigation: Task 6 (sidebar, drawer below lg, active state, deep links via query-string state in Tasks 11, 13, 14, 17).
- Spec 6.5 screens: Login/Invite/Forgot/Reset (7), Dashboard (8, 12), My sheets + Sheet page (9, 10), Inbox + Review (11), Team month (13), Payments (14), Users (15), Teams + Chain editor (16), Overtime types + Audit (17), Profile (18), Notifications menu (12).
- Spec 6.6 UX rules: loading/empty/error in DataTable (4); confirms via ConfirmDialog (9, 10, 14, 15); toasts (3); field errors + server mapping (5, 7, 9, 15); unsaved-changes prompt (9, 15, 16); skip link + focus on route change (6).
- Spec 6.7 testing: unit specs in Tasks 1–17; Playwright flows in Task 19.
- Review Focus: 1 → Task 5 client refresh test. 2 → Task 10 "no Submit on a paid sheet". 3 → Task 10 version-conflict test. 4 → Task 9 schema "rejects empty date" + EntryForm "Pick a date". 5 → Task 6 guard test "blocks employees from admin routes with a toast".
- Type consistency: `SheetDetail.steps` (used by SheetActions and ReviewSheetPage) matches `StepView` in `types.ts`; `InboxRow.step` matches the API plan Task 14; `TeamMonthReport` matches API plan Task 16; `workflowApi.markPaidBulk` body `{ sheets, paymentReference }` matches API plan Task 13 `MarkPaidBulkDto`.
