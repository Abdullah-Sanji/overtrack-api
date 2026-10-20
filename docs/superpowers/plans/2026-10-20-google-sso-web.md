# Google sign-in and department (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a Google sign-in button on the login page (password form behind a link), and surface the new `department` field in the admin users list and form.

**Architecture:** A small composable loads Google Identity Services lazily and renders Google's button into a ref; the login page posts the returned credential through a new auth store action that reuses the password login's session handling. The page has two modes keyed on `VITE_GOOGLE_CLIENT_ID`: unset leaves it exactly as today (local dev and Playwright), set shows Google first. Department is one more field on `PublicUser`, one filter select, one column and one form input.

**Tech Stack:** Vue 3, Pinia, TanStack Query, vee-validate + zod, Tailwind v4, Reka UI, vitest + @vue/test-utils (jsdom), Playwright.

**Spec:** `../specs/2026-10-20-google-sso-and-employee-import-design.md` (sections 3.3, 3.5, 4)

**Companion plan:** `2026-10-20-google-sso-import-api.md` — this plan consumes `POST /auth/google`, `GET /users/departments`, `?department=` and `department` on `PublicUser`. Build that plan first.

**Repo:** all paths are in `../over-track-web` unless prefixed `over-track-api/`.

## Global Constraints

- No new npm package in the web app; the GIS script `https://accounts.google.com/gsi/client` loads at runtime.
- With `VITE_GOOGLE_CLIENT_ID` unset the login page renders exactly as before; the Playwright helpers (`e2e/helpers.ts` fills "Email", "Password", clicks "Sign in") must keep passing with no change.
- Never load the real Google script in unit tests; mock `window.google`.
- Button copy: Google button uses GIS `text: 'signin_with'`; the link reads exactly "Sign in with password"; card description with Google enabled is "Sign in with your company Google account."; unavailable message is "Google sign-in is unavailable".
- Run `pnpm lint`, `pnpm test`, `pnpm build` green before each commit.

## Review Focus

1. The GIS script blocked by an ad blocker or offline: within 5 seconds the page must show "Google sign-in is unavailable" and reveal the password form by itself (Task 3 test "reveals the password form when the script never loads").
2. Google returns a credential for an address that is not a user: the API's 403 message must appear in the alert slot, and the user must still be able to open the password form (Task 3 test "shows the API error from Google sign-in").
3. The `redirect` query parameter must be honoured for Google sign-in the same way as for password sign-in, including rejecting off-site values (Task 3 test "redirects after Google sign-in").
4. Department filter set to a value and then the user clears the search: page must reset to 1 as other filters do (Task 1 test "department filter resets page").

---

### Task 1: Department in types, API client, users list and form

**Files:**
- Modify: `src/api/types.ts` (`PublicUser.department: string | null`)
- Modify: `src/api/users.api.ts` (`UserInput.department?: string | null`, `list` query `department?: string`, `departments()`)
- Modify: `src/test/fixtures.ts` (`makeUser` default `department: null`)
- Modify: `src/features/admin/UsersPage.vue`
- Modify: `src/features/admin/UserFormDrawer.vue`
- Test: `src/features/admin/UsersPage.spec.ts`, `src/features/admin/UserFormDrawer.spec.ts`

**Interfaces:**
- Consumes: `GET /users?department=`, `GET /users/departments` → `{ data: string[] }`, `department` on create/update bodies (API plan Task 1).
- Produces: `usersApi.departments(): Promise<string[]>`; `UserInput.department?: string | null`.

- [ ] **Step 1: Write the failing tests**

In `UsersPage.spec.ts` add to the `vi.mock('@/api/users.api')` factory `departments: vi.fn().mockResolvedValue(['Design', 'Engineering'])`, then:

```ts
it('department filter sends the value and resets the page', async () => {
  list.mockResolvedValue({ data: [makeUser({ department: 'Design' })], meta: { page: 1, pageSize: 20, total: 1 } });
  const w = mountPage(); await flushPromises();
  expect(w.text()).toContain('Design'); // column
  const select = w.findAll('select').find((s) => s.findAll('option').some((o) => o.text() === 'Engineering'))!;
  await select.setValue('Engineering'); await flushPromises();
  expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ department: 'Engineering', page: 1 }));
});
```

(If `Select` is not a native `<select>`, drive it the way the existing role-filter test in this spec does and keep the assertion.)

In `UserFormDrawer.spec.ts`:

```ts
it('sends department on create, and null when left blank', async () => {
  create.mockResolvedValue(makeUser());
  const w = mountDrawer(); await flushPromises();
  await w.find('input[name="firstName"]').setValue('Ann'); await w.find('input[name="lastName"]').setValue('Lee');
  await w.find('input[name="email"]').setValue('ann@x.test'); await w.find('input[name="department"]').setValue(' Design ');
  await w.find('form').trigger('submit'); await flushPromises();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ department: 'Design' }));
  create.mockClear(); const w2 = mountDrawer(); await flushPromises();
  await w2.find('input[name="firstName"]').setValue('Bo'); await w2.find('input[name="lastName"]').setValue('Li'); await w2.find('input[name="email"]').setValue('bo@x.test');
  await w2.find('form').trigger('submit'); await flushPromises();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ department: null }));
});
```

Add `departments: vi.fn().mockResolvedValue(['Design'])` to that spec's `usersApi` mock. Use the same input selectors the existing tests in each spec use if they differ from `input[name=...]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/features/admin`
Expected: FAIL (no department column text, no department input).

- [ ] **Step 3: Types, API client, fixture**

`PublicUser.department: string | null`; `UserInput.department?: string | null`; `usersApi.list` query gains `department?: string`; add `departments: () => get<{ data: string[] }>('/users/departments').then((r) => r.data)`; `makeUser` default `department: null`.

- [ ] **Step 4: Users page**

Add `const department = ref('all')`, include it in the `watch([...])` that resets `page`, add `department: department.value === 'all' ? undefined : department.value` to `params`, query `['users', 'departments']` → `usersApi.departments()`, options `All departments` + each value. Add a fourth `FormField` "Department" with a `Select` (grid becomes `sm:grid-cols-4`). Add column `{ id: 'department', header: 'Department', cell: ({ row }) => row.original.department ?? '—' }` after the team column. Invalidate `['users']` already covers the departments query if it is keyed under `['users', 'departments']`.

- [ ] **Step 5: User form drawer**

Schema: `department: z.string().trim().max(60).nullable()`. Initial values: `u.department` / `null`. Field after Team: `FormField label="Department" name="department"` with an `Input` (`name="department"`, `list="department-suggestions"`, `:model-value="department ?? ''"`) and a `<datalist id="department-suggestions">` fed by `useQuery(['users', 'departments'])`. Submit body: `department: v.department || null` and pass `department` in both `create` and `update` calls.

- [ ] **Step 6: Run the tests to verify they pass, then the full suite**

Run: `pnpm vitest run src/features/admin` then `pnpm test && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/api/types.ts src/api/users.api.ts src/test/fixtures.ts src/features/admin
git commit -m "feat(admin): department filter, column and form field"
```

---

### Task 2: Google login in the API client and auth store

**Files:**
- Modify: `src/api/auth.api.ts`
- Modify: `src/stores/auth.store.ts`
- Test: `src/stores/auth.store.spec.ts`

**Interfaces:**
- Consumes: `POST /auth/google { credential }` → `{ data: { accessToken, user } }` (API plan Task 2).
- Produces: `authApi.loginWithGoogle(credential: string): Promise<{ accessToken: string; user: PublicUser }>`; store action `loginWithGoogle(credential: string): Promise<void>` with the same side effects as `login` (clears query cache, resets notifications, sets token, user and `status = 'ready'`).

- [ ] **Step 1: Write the failing test** in `auth.store.spec.ts`

Add `loginWithGoogle: vi.fn(async () => ({ accessToken: 'g', user: makeUser({ id: 'g1' }) }))` to the mocked `authApi`, then:

```ts
it('loginWithGoogle stores the session like login', async () => {
  const auth = useAuthStore();
  await auth.loginWithGoogle('credential-token');
  expect(auth.accessToken).toBe('g'); expect(auth.user?.id).toBe('g1'); expect(auth.status).toBe('ready'); expect(auth.isAuthenticated).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/stores/auth.store.spec.ts`
Expected: FAIL (`loginWithGoogle is not a function`).

- [ ] **Step 3: Implement**

`auth.api.ts`: `loginWithGoogle: (credential: string) => request<{ data: { accessToken: string; user: PublicUser } }>('POST', '/auth/google', { body: { credential }, skipAuth: true }).then((r) => r.data)`. Store: extract the body of `login` after the API call into a private `applySession(r: { accessToken: string; user: PublicUser })`; `login` and the new `loginWithGoogle` both call it; export `loginWithGoogle` from the store's returned object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/stores && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/auth.api.ts src/stores/auth.store.ts src/stores/auth.store.spec.ts
git commit -m "feat(auth): loginWithGoogle in API client and store"
```

---

### Task 3: Google button on the login page

**Files:**
- Create: `src/features/auth/useGoogleIdentity.ts`
- Modify: `src/features/auth/LoginPage.vue`
- Modify: `src/vite-env.d.ts` (declare `VITE_GOOGLE_CLIENT_ID?: string` on `ImportMetaEnv`)
- Modify: `.env.example`, `Dockerfile`, `README.md`
- Modify: `over-track-api/docker-compose.prod.yml` (web build arg)
- Test: `src/features/auth/LoginPage.spec.ts`

**Interfaces:**
- Consumes: `useAuthStore().loginWithGoogle` (Task 2).
- Produces: `useGoogleIdentity(opts: { clientId: string; onCredential: (credential: string) => void; onUnavailable: () => void; timeoutMs?: number }): { buttonEl: Ref<HTMLElement | null> }` — on mount, ensures the GIS script is loaded (resolves immediately if `window.google?.accounts?.id` exists; otherwise injects `<script src="https://accounts.google.com/gsi/client" async defer>` once per document), then calls `google.accounts.id.initialize({ client_id, callback: (r) => onCredential(r.credential) })` and `renderButton(buttonEl.value, { type: 'standard', size: 'large', shape: 'rectangular', text: 'signin_with', width, theme })` with `width` = the element's `clientWidth` (minimum 200) and `theme` = `'filled_black'` when `useUiStore().theme === 'dark'`, else `'outline'`. If the script has not loaded within `timeoutMs` (default 5000) or errors, calls `onUnavailable()` once.

- [ ] **Step 1: Write the failing tests** in `LoginPage.spec.ts`

Add a second `describe('LoginPage with Google')`. In `beforeEach`: `vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid')`, define `const initialize = vi.fn(); const renderButton = vi.fn();` and set `(window as any).google = { accounts: { id: { initialize, renderButton } } }`. In `afterEach`: `vi.unstubAllEnvs(); delete (window as any).google;`. Tests:

```ts
it('renders the Google button, hides the form until the link is clicked', async () => {
  const w = mount(LoginPage, { global: { plugins: [createTestingPinia({ stubActions: true, createSpy: vi.fn })] } }); await flushPromises();
  expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'cid' })); expect(renderButton).toHaveBeenCalled();
  expect(w.text()).toContain('Sign in with your company Google account.'); expect(w.find('form').exists()).toBe(false);
  await w.findAll('button').find((b) => b.text() === 'Sign in with password')!.trigger('click');
  expect(w.find('input[type="email"]').exists()).toBe(true); expect(w.text()).not.toContain('Sign in with password');
});
it('redirects after Google sign-in and rejects off-site redirect', async () => {
  mockRoute.query = { redirect: '//evil.com' };
  const w = mount(LoginPage, { global: { plugins: [createTestingPinia({ stubActions: true, createSpy: vi.fn })] } }); await flushPromises();
  const cb = initialize.mock.calls[0][0].callback as (r: { credential: string }) => void;
  cb({ credential: 'tok' }); await flushPromises();
  const { useAuthStore } = await import('@/stores/auth.store');
  expect(useAuthStore().loginWithGoogle).toHaveBeenCalledWith('tok'); expect(push).toHaveBeenCalledWith({ name: 'dashboard' });
});
it('shows the API error from Google sign-in', async () => {
  const w = mount(LoginPage, { global: { plugins: [createTestingPinia({ stubActions: true, createSpy: vi.fn })] } }); await flushPromises();
  const { useAuthStore } = await import('@/stores/auth.store');
  (useAuthStore().loginWithGoogle as Mock).mockRejectedValueOnce(new ApiError(403, 'GOOGLE_ACCOUNT_UNKNOWN', 'No OverTrack account for this Google address. Ask your admin.'));
  (initialize.mock.calls[0][0].callback as (r: { credential: string }) => void)({ credential: 'tok' }); await flushPromises();
  expect(w.find('[role="alert"]').text()).toContain('No OverTrack account for this Google address. Ask your admin.');
});
it('reveals the password form when the script never loads', async () => {
  delete (window as any).google; vi.useFakeTimers();
  const w = mount(LoginPage, { global: { plugins: [createTestingPinia({ stubActions: true, createSpy: vi.fn })] } }); await flushPromises();
  expect(w.find('form').exists()).toBe(false);
  await vi.advanceTimersByTimeAsync(5000); await flushPromises();
  expect(w.find('[role="alert"]').text()).toContain('Google sign-in is unavailable'); expect(w.find('input[type="email"]').exists()).toBe(true);
  vi.useRealTimers();
});
```

The existing `describe('LoginPage')` tests stay unchanged and must still pass, proving the unset mode is untouched. Import `ApiError` from `@/api/errors` and `type Mock` from `vitest`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/features/auth/LoginPage.spec.ts`
Expected: the new describe FAILS (no Google text, form always present); the old describe PASSES.

- [ ] **Step 3: Implement `useGoogleIdentity`** in `src/features/auth/useGoogleIdentity.ts`

Per the Interfaces block. Module-level `let loading: Promise<void> | null` so the script is injected once per page. Declare a minimal `Window['google']` type in the same file (`accounts.id.initialize`, `renderButton`). Use `onMounted` to start and `onBeforeUnmount` to clear the timeout.

- [ ] **Step 4: Update `LoginPage.vue`**

`const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''`, `const showPassword = ref(!googleClientId)`. When `googleClientId` is set: card description "Sign in with your company Google account.", a `<div ref="buttonEl" class="flex justify-center">` for the Google button, and below it, while `!showPassword`, a plain `<button type="button">` styled as the app's text link (`text-sm text-primary underline-offset-2 hover:underline`) reading "Sign in with password" that sets `showPassword = true`. The existing `<form>` renders only when `showPassword` and keeps its current markup and description-less card when Google is unset (`AuthCard` description switches with `googleClientId`). The alert `<p role="alert">` moves above both the button and the form so it shows in either mode. `onCredential`: `formError = ''`, `await auth.loginWithGoogle(credential)`, `router.push(redirectTarget())`, catch → `formError = messageFor(e)`. `onUnavailable`: `formError = 'Google sign-in is unavailable'; showPassword = true`.

- [ ] **Step 5: Run the tests to verify they pass, then the full suite**

Run: `pnpm vitest run src/features/auth` then `pnpm test && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 6: Config, Docker, docs**

`src/vite-env.d.ts`: add `interface ImportMetaEnv { readonly VITE_API_URL?: string; readonly VITE_GOOGLE_CLIENT_ID?: string } interface ImportMeta { readonly env: ImportMetaEnv }`. `.env.example`: `# VITE_GOOGLE_CLIENT_ID=` with comment "optional; shows the Google button". `Dockerfile`: `ARG VITE_GOOGLE_CLIENT_ID=` and `ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID` next to the existing `VITE_API_URL` lines. `over-track-api/docker-compose.prod.yml` web service: `build: { context: ../over-track-web, args: { VITE_GOOGLE_CLIENT_ID: "${GOOGLE_CLIENT_ID:-}" } }`. Web `README.md` run-locally and Docker sections: one line each on `VITE_GOOGLE_CLIENT_ID` pointing to the API README's Google sign-in section.

- [ ] **Step 7: Playwright still green with Google unset**

Run (with the API running against a seeded database, per the web README): `pnpm e2e`
Expected: all specs pass with no change to `e2e/helpers.ts`.

- [ ] **Step 8: Commit (both repos)**

```bash
git add src/features/auth src/vite-env.d.ts .env.example Dockerfile README.md
git commit -m "feat(auth): Google sign-in button with password fallback link"
cd ../over-track-api && git add docker-compose.prod.yml && git commit -m "build: pass GOOGLE_CLIENT_ID to the web image"
```
