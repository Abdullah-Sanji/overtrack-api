# OverTrack API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `over-track-api` NestJS backend that stores overtime sheets, runs the per-team approval workflow, tracks payment status and produces exports.

**Architecture:** Modular NestJS monolith on Fastify. Each domain module owns its Drizzle tables and exposes one service. All sheet state changes go through a pure `transition()` function wrapped by `WorkflowService`, which runs the transaction, row lock, audit write and domain events. Notifications listen to events; no queue.

**Tech Stack:** Node 22, pnpm, NestJS 11, @nestjs/platform-fastify, Postgres 16, Drizzle ORM + drizzle-kit, Zod + nestjs-zod, @nestjs/jwt, argon2, @nestjs/event-emitter, @nestjs/schedule, nodemailer, exceljs, Vitest, Testcontainers.

**Spec:** `docs/superpowers/specs/2026-10-18-overtrack-design.md` (sections 2–5, 7, 8 apply to this repo)

## Global Constraints

- Node ≥ 22, pnpm ≥ 9. TypeScript `strict: true`.
- NestJS ≥ 11 with the Fastify adapter. Never import `express`.
- All routes under prefix `/api/v1`. List responses `{ data: T[], meta: { page, pageSize, total } }`, single `{ data: T }`, errors `{ statusCode, code, message, details? }`.
- `pageSize` max 100, default 20. `page` is 1-based.
- Access JWT TTL 15 min; refresh cookie `ot_refresh`, httpOnly, SameSite=Lax, 7 days, hashed in DB, rotated on use.
- Password ≥ 10 chars. Argon2id hashing.
- Attachments: `image/png`, `image/jpeg`, `application/pdf` only, max 5 MB, one per entry.
- Entry hours in 0.25 steps, 0.25 ≤ hours ≤ 16. Description 10–1000 chars. Work item ≤ 120 chars.
- Overtime multiplier `numeric(4,2)` > 0. Default types: Weekday extra hours 1.50, Weekend 2.00, Public holiday 2.50, On-call / standby 1.00.
- Rejection reason ≥ 5 chars. Payment reference ≤ 60 chars.
- Swagger UI at `/docs`, JSON at `/docs-json`, only when `NODE_ENV !== 'production'`.
- Every sheet transition: one transaction, `FOR UPDATE` lock, version check (`409 SHEET_VERSION_CONFLICT`), audit row, events emitted after commit.
- Secrets only from env. Never log tokens or password hashes.
- Commit after every task with a conventional-commit message.

## Review Focus

1. **Entry with `endTime` earlier than `startTime` or crossing midnight** — must be rejected with `VALIDATION_FAILED`, never stored as negative hours. (Test added to Task 9.)
2. **Two approvers racing on the same step** — the second request must get `409 SHEET_VERSION_CONFLICT`, not a double advance. (Test added to Task 13.)
3. **Refresh token replay after rotation** — reusing an already-rotated refresh token must revoke the whole family and return `401 TOKEN_REUSED`. (Test added to Task 4.)
4. **Chain edited while a sheet is in flight** — the in-flight sheet keeps its snapshot; the next approver comes from the snapshot, not the edited chain. (Test added to Task 13.)
5. **Tech lead who is the sheet owner and also the backup on a later step** — self-skip applies to any step where approver OR backup is the owner only for the approver slot; backup-self is ignored (the primary still decides), and a chain whose every primary is the owner auto-approves. (Test added to Task 12.)

---

## File structure

```
over-track-api/
  package.json  tsconfig.json  tsconfig.build.json  nest-cli.json  vitest.config.ts  drizzle.config.ts
  eslint.config.js  .prettierrc  .env.example  .gitignore  docker-compose.yml  Dockerfile  docker-compose.prod.yml
  drizzle/                       generated SQL migrations
  src/
    main.ts  app.module.ts
    common/
      config/env.ts              zod env schema + Env type
      errors/domain-error.ts     DomainError + ErrorCode union
      errors/http-exception.filter.ts
      auth/jwt-auth.guard.ts  auth/roles.guard.ts  auth/current-user.decorator.ts  auth/roles.decorator.ts  auth/public.decorator.ts  auth/auth-user.ts
      pagination.ts              parsePagination + paged() helper
      zod.ts                     shared zod fragments (uuid, period, pagination query)
    database/
      database.module.ts  drizzle.service.ts  migrate.ts  seed.ts
      schema/index.ts enums.ts users-teams.ts approval-chain-steps.ts overtime-types.ts sheets.ts sheet-entries.ts
             sheet-approval-steps.ts attachments.ts audit-log.ts notifications.ts tokens.ts settings.ts
    health/health.module.ts health.controller.ts
    mail/mail.module.ts mail.service.ts templates.ts
    auth/auth.module.ts auth.controller.ts auth.service.ts token.service.ts auth.dto.ts
    users/users.module.ts users.controller.ts me.controller.ts users.service.ts users.dto.ts
    teams/teams.module.ts teams.controller.ts teams.service.ts teams.dto.ts
    approval-chains/approval-chains.module.ts approval-chains.controller.ts approval-chains.service.ts approval-chains.dto.ts
    overtime-types/overtime-types.module.ts overtime-types.controller.ts overtime-types.service.ts overtime-types.dto.ts
    audit/audit.module.ts audit.service.ts audit.controller.ts
    sheets/sheets.module.ts sheets.controller.ts sheets.service.ts entries.service.ts sheets.dto.ts visibility.service.ts
    attachments/attachments.module.ts attachments.controller.ts attachments.service.ts storage.service.ts
    workflow/workflow.module.ts transition.ts workflow.service.ts workflow.controller.ts inbox.service.ts inbox.controller.ts workflow.dto.ts
    notifications/notifications.module.ts notifications.service.ts notifications.listener.ts notifications.controller.ts reminder.service.ts
    reports/reports.module.ts reports.controller.ts team-month.service.ts export.service.ts reports.dto.ts
  test/
    setup/global-setup.ts        starts Postgres container, runs migrations, exports DATABASE_URL
    helpers/app.ts               createTestApp(), login(), truncateAll()
    helpers/factories.ts         createUser(), createTeam(), createChain(), createSheetWithEntries()
    *.e2e.spec.ts
```

---

### Task 1: Project scaffold, config, Fastify bootstrap, health endpoint

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.gitignore`, `.env.example`, `docker-compose.yml`
- Create: `src/main.ts`, `src/app.module.ts`, `src/common/config/env.ts`, `src/health/health.module.ts`, `src/health/health.controller.ts`
- Create: `test/helpers/app.ts`, `test/health.e2e.spec.ts`

**Interfaces:**
- Produces: `Env` type and `envSchema` (`src/common/config/env.ts`); `createTestApp(): Promise<NestFastifyApplication>` (`test/helpers/app.ts`); `GET /api/v1/health → { data: { status: 'ok' } }`.

- [ ] **Step 1: Initialize the project**

```bash
cd /Users/sanji/WebstormProjects/over-track-api
pnpm init
pnpm add @nestjs/common@^11 @nestjs/core@^11 @nestjs/platform-fastify@^11 @nestjs/config@^4 @nestjs/swagger@^11 \
  @fastify/helmet@^13 @fastify/cookie@^11 @fastify/rate-limit@^10 @fastify/multipart@^9 \
  nestjs-zod@^4 zod@^3.25 reflect-metadata rxjs
pnpm add -D @nestjs/cli@^11 @nestjs/testing@^11 typescript@^5.8 @types/node@^22 vitest@^3 unplugin-swc @swc/core \
  eslint@^9 @eslint/js typescript-eslint prettier tsx
```

- [ ] **Step 2: Write config files**

`package.json` scripts (merge into the generated file):
```json
{
  "name": "over-track-api",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "lint": "eslint \"src/**/*.ts\" \"test/**/*.ts\"",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/database/migrate.ts",
    "seed": "tsx src/database/seed.ts"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs", "target": "ES2022", "lib": ["ES2022"],
    "declaration": false, "removeComments": true,
    "emitDecoratorMetadata": true, "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true, "esModuleInterop": true,
    "sourceMap": true, "outDir": "./dist", "baseUrl": "./",
    "incremental": true, "skipLibCheck": true,
    "strict": true, "noImplicitOverride": true, "forceConsistentCasingInFileNames": true,
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "test", "drizzle.config.ts"]
}
```

`tsconfig.build.json`:
```json
{ "extends": "./tsconfig.json", "exclude": ["node_modules", "test", "dist", "**/*.spec.ts"] }
```

`nest-cli.json`:
```json
{ "$schema": "https://json.schemastore.org/nest-cli", "collection": "@nestjs/schematics", "sourceRoot": "src", "compilerOptions": { "deleteOutDir": true } }
```

`vitest.config.ts`:
```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: false,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    environment: 'node',
    hookTimeout: 120_000,
    testTimeout: 30_000,
    fileParallelism: false,
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  plugins: [swc.vite({ module: { type: 'commonjs' }, jsc: { transform: { legacyDecorator: true, decoratorMetadata: true } } })],
});
```

`eslint.config.js`:
```js
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
module.exports = tseslint.config(
  { ignores: ['dist', 'node_modules', 'drizzle'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
```

`.prettierrc`:
```json
{ "singleQuote": true, "trailingComma": "all", "printWidth": 110 }
```

`.gitignore`:
```
node_modules
dist
.env
storage
coverage
```

`.env.example`:
```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://overtrack:overtrack@localhost:5432/overtrack
JWT_SECRET=change-me-to-a-long-random-string
JWT_ACCESS_TTL_SECONDS=900
REFRESH_TTL_DAYS=7
WEB_URL=http://localhost:5173
CORS_ORIGIN=http://localhost:5173
SMTP_URL=smtp://localhost:1025
MAIL_FROM="OverTrack <no-reply@overtrack.local>"
STORAGE_PATH=./storage
DEFAULT_TIMEZONE=Asia/Riyadh
```

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: overtrack
      POSTGRES_PASSWORD: overtrack
      POSTGRES_DB: overtrack
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
  mailhog:
    image: mailhog/mailhog
    ports: ["1025:1025", "8025:8025"]
volumes:
  pgdata:
```

- [ ] **Step 3: Write the env schema**

`src/common/config/env.ts`:
```ts
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  WEB_URL: z.string().url(),
  CORS_ORIGIN: z.string().min(1),
  SMTP_URL: z.string().min(1),
  MAIL_FROM: z.string().min(1),
  STORAGE_PATH: z.string().min(1).default('./storage'),
  DEFAULT_TIMEZONE: z.string().min(1).default('UTC'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return result.data;
}
```

- [ ] **Step 4: Write the failing health test**

`test/helpers/app.ts`:
```ts
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '@/app.module';
import { configureApp } from '@/main';

export async function createTestApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
```

`test/health.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './helpers/app';

describe('GET /api/v1/health', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  it('returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'ok' } });
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cp .env.example .env && pnpm vitest run test/health.e2e.spec.ts`
Expected: FAIL — cannot resolve `@/app.module`.

- [ ] **Step 6: Write the app bootstrap**

`src/health/health.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { data: { status: 'ok' } };
  }
}
```

`src/health/health.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

`src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { validateEnv } from './common/config/env';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env'] }),
    HealthModule,
  ],
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
})
export class AppModule {}
```

`src/main.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import { AppModule } from './app.module';
import { Env } from './common/config/env';

export async function configureApp(app: NestFastifyApplication): Promise<void> {
  const config = app.get(ConfigService<Env, true>);
  app.setGlobalPrefix('api/v1');
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  app.enableCors({ origin: config.get('CORS_ORIGIN').split(','), credentials: true });

  if (config.get('NODE_ENV') !== 'production') {
    const doc = new DocumentBuilder().setTitle('OverTrack API').setVersion('1').addBearerAuth().build();
    const document = SwaggerModule.createDocument(app, doc);
    SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document), { jsonDocumentUrl: 'docs-json' });
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: true }));
  await configureApp(app);
  const config = app.get(ConfigService<Env, true>);
  await app.listen(config.get('PORT'), '0.0.0.0');
}

if (require.main === module) {
  bootstrap();
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run test/health.e2e.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 8: Verify dev server and Swagger**

Run: `docker compose up -d && pnpm start:dev` then in another shell `curl -s localhost:3000/api/v1/health` → `{"data":{"status":"ok"}}` and `curl -s -o /dev/null -w "%{http_code}" localhost:3000/docs` → `200`. Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: scaffold NestJS Fastify app with env validation and health endpoint"
```

---

### Task 2: Drizzle schema, migrations and database module

**Files:**
- Create: `drizzle.config.ts`, `src/database/schema/*.ts`, `src/database/drizzle.service.ts`, `src/database/database.module.ts`, `src/database/migrate.ts`
- Create: `test/setup/global-setup.ts`, `test/helpers/db.ts`, `test/database.e2e.spec.ts`
- Modify: `vitest.config.ts` (add globalSetup), `src/app.module.ts` (import DatabaseModule), `src/health/health.controller.ts` (db ping)

**Interfaces:**
- Produces: `DrizzleService` with `db: Db`; types `Db`, `Tx`, `DbOrTx`; the full `schema` barrel; enums `userRoleEnum`, `sheetStatusEnum`, `approvalStepStatusEnum`, `passwordTokenPurposeEnum`; `truncateAll(db)` test helper.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add drizzle-orm@^0.44 pg@^8
pnpm add -D drizzle-kit@^0.31 @types/pg @testcontainers/postgresql@^11
```

- [ ] **Step 2: Write the schema files**

`src/database/schema/enums.ts`:
```ts
import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['employee', 'tech_lead', 'delivery_manager', 'cto', 'finance', 'admin']);
export const sheetStatusEnum = pgEnum('sheet_status', ['draft', 'submitted', 'approved', 'rejected', 'paid']);
export const approvalStepStatusEnum = pgEnum('approval_step_status', ['pending', 'approved', 'rejected', 'skipped']);
export const passwordTokenPurposeEnum = pgEnum('password_token_purpose', ['invite', 'reset']);

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type SheetStatus = (typeof sheetStatusEnum.enumValues)[number];
export type ApprovalStepStatus = (typeof approvalStepStatusEnum.enumValues)[number];
```

`src/database/schema/users-teams.ts` (users and teams share a file because they reference each other):
```ts
import { pgTable, uuid, text, boolean, timestamp, uniqueIndex, AnyPgColumn } from 'drizzle-orm/pg-core';
import { userRoleEnum } from './enums';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  techLeadId: uuid('tech_lead_id').references((): AnyPgColumn => users.id),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeCode: text('employee_code'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    role: userRoleEnum('role').notNull().default('employee'),
    teamId: uuid('team_id').references(() => teams.id),
    timezone: text('timezone').notNull().default('UTC'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email), uniqueIndex('users_employee_code_idx').on(t.employeeCode)],
);

export { timestamps };
```

`src/database/schema/approval-chain-steps.ts`:
```ts
import { pgTable, uuid, text, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { teams, users, timestamps } from './users-teams';

export const approvalChainSteps = pgTable(
  'approval_chain_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    approverId: uuid('approver_id').notNull().references(() => users.id),
    backupApproverId: uuid('backup_approver_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex('chain_steps_team_position_idx').on(t.teamId, t.position)],
);
```

`src/database/schema/overtime-types.ts`:
```ts
import { pgTable, uuid, text, numeric, integer, boolean } from 'drizzle-orm/pg-core';
import { timestamps } from './users-teams';

export const overtimeTypes = pgTable('overtime_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  multiplier: numeric('multiplier', { precision: 4, scale: 2 }).notNull(),
  color: text('color').notNull().default('#2563EB'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});
```

`src/database/schema/sheets.ts`:
```ts
import { pgTable, uuid, date, integer, numeric, timestamp, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { users, timestamps } from './users-teams';
import { sheetStatusEnum } from './enums';

export const sheets = pgTable(
  'sheets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id').notNull().references(() => users.id),
    period: date('period').notNull(), // first day of month, YYYY-MM-01
    status: sheetStatusEnum('status').notNull().default('draft'),
    round: integer('round').notNull().default(1),
    currentStepPosition: integer('current_step_position'),
    totalHours: numeric('total_hours', { precision: 7, scale: 2 }).notNull().default('0'),
    totalWeightedHours: numeric('total_weighted_hours', { precision: 8, scale: 2 }).notNull().default('0'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paidById: uuid('paid_by_id').references(() => users.id),
    paymentReference: text('payment_reference'),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [uniqueIndex('sheets_employee_period_idx').on(t.employeeId, t.period), index('sheets_status_idx').on(t.status)],
);
```

`src/database/schema/sheet-entries.ts`:
```ts
import { pgTable, uuid, date, time, numeric, text, index } from 'drizzle-orm/pg-core';
import { sheets } from './sheets';
import { overtimeTypes } from './overtime-types';
import { users, timestamps } from './users-teams';
import { attachments } from './attachments';

export const sheetEntries = pgTable(
  'sheet_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sheetId: uuid('sheet_id').notNull().references(() => sheets.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    hours: numeric('hours', { precision: 4, scale: 2 }).notNull(),
    overtimeTypeId: uuid('overtime_type_id').notNull().references(() => overtimeTypes.id),
    multiplierSnapshot: numeric('multiplier_snapshot', { precision: 4, scale: 2 }).notNull(),
    weightedHours: numeric('weighted_hours', { precision: 6, scale: 2 }).notNull(),
    workItem: text('work_item').notNull(),
    workItemUrl: text('work_item_url'),
    description: text('description').notNull(),
    requestedById: uuid('requested_by_id').references(() => users.id),
    attachmentId: uuid('attachment_id').references(() => attachments.id),
    ...timestamps,
  },
  (t) => [index('sheet_entries_sheet_idx').on(t.sheetId)],
);
```

`src/database/schema/sheet-approval-steps.ts`:
```ts
import { pgTable, uuid, integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sheets } from './sheets';
import { users } from './users-teams';
import { approvalStepStatusEnum } from './enums';

export const sheetApprovalSteps = pgTable(
  'sheet_approval_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sheetId: uuid('sheet_id').notNull().references(() => sheets.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    approverId: uuid('approver_id').notNull().references(() => users.id),
    backupApproverId: uuid('backup_approver_id').references(() => users.id),
    status: approvalStepStatusEnum('status').notNull().default('pending'),
    decidedById: uuid('decided_by_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    comment: text('comment'),
    overrideReason: text('override_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sheet_steps_sheet_round_position_idx').on(t.sheetId, t.round, t.position)],
);
```

`src/database/schema/attachments.ts`:
```ts
import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users-teams';

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  storageKey: text('storage_key').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`src/database/schema/audit-log.ts`:
```ts
import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users-teams';

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_entity_idx').on(t.entityType, t.entityId), index('audit_actor_idx').on(t.actorId)],
);
```

`src/database/schema/notifications.ts`:
```ts
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users-teams';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt)],
);
```

`src/database/schema/tokens.ts`:
```ts
import { pgTable, uuid, text, timestamp, AnyPgColumn, index } from 'drizzle-orm/pg-core';
import { users } from './users-teams';
import { passwordTokenPurposeEnum } from './enums';

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id').references((): AnyPgColumn => refreshTokens.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('refresh_tokens_hash_idx').on(t.tokenHash), index('refresh_tokens_family_idx').on(t.familyId)],
);

export const passwordTokens = pgTable('password_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  purpose: passwordTokenPurposeEnum('purpose').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`src/database/schema/settings.ts`:
```ts
import { pgTable, integer, text, timestamp } from 'drizzle-orm/pg-core';

export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  companyName: text('company_name').notNull().default('OverTrack'),
  defaultTimezone: text('default_timezone').notNull().default('UTC'),
  reminderDayOfMonth: integer('reminder_day_of_month').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`src/database/schema/index.ts`:
```ts
export * from './enums';
export * from './users-teams';
export * from './approval-chain-steps';
export * from './overtime-types';
export * from './sheets';
export * from './sheet-entries';
export * from './sheet-approval-steps';
export * from './attachments';
export * from './audit-log';
export * from './notifications';
export * from './tokens';
export * from './settings';
```

`drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://overtrack:overtrack@localhost:5432/overtrack' },
});
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a file `drizzle/0000_*.sql` creating 13 tables and 4 enums. Open it and confirm `sheets_employee_period_idx` is a unique index.

- [ ] **Step 4: Write DrizzleService, DatabaseModule and migrate script**

`src/database/drizzle.service.ts`:
```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { Env } from '@/common/config/env';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

@Injectable()
export class DrizzleService implements OnModuleDestroy {
  readonly pool: Pool;
  readonly db: Db;

  constructor(config: ConfigService<Env, true>) {
    this.pool = new Pool({ connectionString: config.get('DATABASE_URL') });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
```

`src/database/database.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { DrizzleService } from './drizzle.service';

@Global()
@Module({ providers: [DrizzleService], exports: [DrizzleService] })
export class DatabaseModule {}
```

`src/database/migrate.ts`:
```ts
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'node:path';

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations(process.env.DATABASE_URL!).then(() => console.log('migrations applied'));
}
```

Install dotenv for the script: `pnpm add dotenv`.

Modify `src/app.module.ts` imports: add `DatabaseModule` after `ConfigModule.forRoot(...)`.

Modify `src/health/health.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';

@Controller('health')
export class HealthController {
  constructor(private readonly drizzle: DrizzleService) {}

  @Get()
  async check() {
    await this.drizzle.db.execute(sql`select 1`);
    return { data: { status: 'ok' } };
  }
}
```

- [ ] **Step 5: Write the test global setup and db helper**

`test/setup/global-setup.ts`:
```ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '../../src/database/migrate';

let container: StartedPostgreSqlContainer;

export async function setup() {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
  process.env.WEB_URL = 'http://localhost:5173';
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  process.env.SMTP_URL = 'smtp://localhost:1025';
  process.env.MAIL_FROM = 'test@overtrack.local';
  process.env.STORAGE_PATH = './storage-test';
  await runMigrations(url);
  return async () => { await container.stop(); };
}
```

Because `globalSetup` runs in a separate process, the env must also reach the worker. Add to `vitest.config.ts` test options:
```ts
globalSetup: ['test/setup/global-setup.ts'],
```
and create `test/setup/env.ts` registered as `setupFiles: ['test/setup/env.ts']`:
```ts
// Vitest passes globalSetup-provided env to workers via process.env when set before workers spawn.
// Guard defaults for running a single spec directly.
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-1234';
process.env.WEB_URL ??= 'http://localhost:5173';
process.env.CORS_ORIGIN ??= 'http://localhost:5173';
process.env.SMTP_URL ??= 'smtp://localhost:1025';
process.env.MAIL_FROM ??= 'test@overtrack.local';
process.env.STORAGE_PATH ??= './storage-test';
```
Note: Vitest ≥ 1 propagates `process.env` mutations made in `globalSetup` to workers because workers are forked after setup. Keep `fileParallelism: false` so specs share the single container sequentially.

`test/helpers/db.ts`:
```ts
import { sql } from 'drizzle-orm';
import { Db } from '@/database/drizzle.service';

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE notifications, audit_log, refresh_tokens, password_tokens, sheet_approval_steps,
      sheet_entries, attachments, sheets, approval_chain_steps, overtime_types, users, teams, settings
    RESTART IDENTITY CASCADE
  `);
}
```

- [ ] **Step 6: Write the failing database test**

`test/database.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { createTestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { DrizzleService } from '@/database/drizzle.service';
import { users, sheets } from '@/database/schema';

describe('database', () => {
  let app: NestFastifyApplication;
  let drizzle: DrizzleService;
  beforeAll(async () => { app = await createTestApp(); drizzle = app.get(DrizzleService); await truncateAll(drizzle.db); });
  afterAll(async () => { await app.close(); });

  it('inserts a user and a sheet and enforces the unique period per employee', async () => {
    const [u] = await drizzle.db.insert(users).values({ firstName: 'A', lastName: 'B', email: 'a@b.c' }).returning();
    await drizzle.db.insert(sheets).values({ employeeId: u.id, period: '2026-09-01' });
    await expect(drizzle.db.insert(sheets).values({ employeeId: u.id, period: '2026-09-01' })).rejects.toThrow(/duplicate key/);
    const rows = await drizzle.db.select().from(sheets).where(eq(sheets.employeeId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('draft');
  });

  it('health pings the database', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 7: Run tests**

Run: `pnpm test`
Expected: PASS for `database.e2e.spec.ts` and `health.e2e.spec.ts` (container start takes ~10 s the first time).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add Drizzle schema, migrations, database module and test container setup"
```

---

### Task 3: Domain errors, exception filter, pagination and shared zod fragments

**Files:**
- Create: `src/common/errors/domain-error.ts`, `src/common/errors/http-exception.filter.ts`, `src/common/pagination.ts`, `src/common/zod.ts`
- Create: `src/common/errors/http-exception.filter.spec.ts`, `src/common/pagination.spec.ts`
- Modify: `src/app.module.ts` (register filter via `APP_FILTER`)

**Interfaces:**
- Produces: `class DomainError extends Error { code: ErrorCode; status: number; details?: unknown }`, `ErrorCode` union, `parsePagination(q) → { page, pageSize, offset, limit }`, `paged(data, total, p)`, `zUuid`, `zPeriod` (`YYYY-MM`), `zPaginationQuery`, `periodToDate('2026-09') → '2026-09-01'`.

- [ ] **Step 1: Write failing tests**

`src/common/pagination.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parsePagination, paged } from './pagination';

describe('parsePagination', () => {
  it('defaults to page 1 size 20', () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 20, offset: 0, limit: 20 });
  });
  it('caps pageSize at 100 and floors page at 1', () => {
    expect(parsePagination({ page: 0, pageSize: 500 })).toEqual({ page: 1, pageSize: 100, offset: 0, limit: 100 });
  });
  it('computes offset', () => {
    expect(parsePagination({ page: 3, pageSize: 10 }).offset).toBe(20);
  });
  it('wraps a page', () => {
    expect(paged([1, 2], 7, { page: 2, pageSize: 2 })).toEqual({ data: [1, 2], meta: { page: 2, pageSize: 2, total: 7 } });
  });
});
```

`src/common/errors/http-exception.filter.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { ArgumentsHost, NotFoundException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import { HttpExceptionFilter } from './http-exception.filter';
import { DomainError } from './domain-error';

function host() {
  const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
  const h = { switchToHttp: () => ({ getResponse: () => reply, getRequest: () => ({ url: '/x' }) }) } as unknown as ArgumentsHost;
  return { h, reply };
}

describe('HttpExceptionFilter', () => {
  it('maps DomainError to its status and code', () => {
    const { h, reply } = host();
    new HttpExceptionFilter().catch(new DomainError('SHEET_NOT_EDITABLE', 'Sheet is locked', 409), h);
    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith({ statusCode: 409, code: 'SHEET_NOT_EDITABLE', message: 'Sheet is locked' });
  });
  it('maps zod validation to VALIDATION_FAILED with field details', () => {
    const { h, reply } = host();
    const err = z.object({ email: z.string().email() }).safeParse({ email: 'x' });
    new HttpExceptionFilter().catch(new ZodValidationException((err as { error: z.ZodError }).error), h);
    expect(reply.status).toHaveBeenCalledWith(400);
    const body = reply.send.mock.calls[0][0];
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details[0].path).toBe('email');
  });
  it('maps Nest HttpException to its status with a generic code', () => {
    const { h, reply } = host();
    new HttpExceptionFilter().catch(new NotFoundException('nope'), h);
    expect(reply.send).toHaveBeenCalledWith({ statusCode: 404, code: 'NOT_FOUND', message: 'nope' });
  });
  it('maps unknown errors to 500 INTERNAL', () => {
    const { h, reply } = host();
    new HttpExceptionFilter().catch(new Error('boom'), h);
    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send.mock.calls[0][0].code).toBe('INTERNAL');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/common`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/common/errors/domain-error.ts`:
```ts
export const ERROR_CODES = [
  'INVALID_CREDENTIALS', 'TOKEN_EXPIRED', 'TOKEN_REUSED', 'TOKEN_INVALID', 'USER_INACTIVE', 'UNAUTHORIZED', 'FORBIDDEN',
  'NOT_FOUND', 'CONFLICT', 'VALIDATION_FAILED', 'SHEET_NOT_EDITABLE', 'SHEET_VERSION_CONFLICT', 'SHEET_EMPTY', 'CHAIN_EMPTY',
  'CHAIN_APPROVER_INACTIVE', 'NOT_CURRENT_APPROVER', 'INVALID_TRANSITION', 'ENTRY_OVERLAP', 'ENTRY_OUT_OF_PERIOD',
  'ENTRY_IN_FUTURE', 'ATTACHMENT_TOO_LARGE', 'ATTACHMENT_TYPE', 'ATTACHMENT_EXISTS', 'REASON_REQUIRED',
  'PAYMENT_REFERENCE_REQUIRED', 'EMAIL_TAKEN', 'EMPLOYEE_CODE_TAKEN', 'TEAM_NAME_TAKEN', 'USER_HAS_NO_TEAM', 'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (what: string) => new DomainError('NOT_FOUND', `${what} not found`, 404);
export const forbidden = (msg = 'Forbidden') => new DomainError('FORBIDDEN', msg, 403);
```

`src/common/errors/http-exception.filter.ts`:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { FastifyReply } from 'fastify';
import { DomainError } from './domain-error';

const STATUS_TO_CODE: Record<number, string> = { 400: 'VALIDATION_FAILED', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'ATTACHMENT_TOO_LARGE', 429: 'RATE_LIMITED' };

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof DomainError) {
      const body: Record<string, unknown> = { statusCode: exception.status, code: exception.code, message: exception.message };
      if (exception.details !== undefined) body.details = exception.details;
      return reply.status(exception.status).send(body);
    }
    if (exception instanceof ZodValidationException) {
      const details = exception.getZodError().issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return reply.status(400).send({ statusCode: 400, code: 'VALIDATION_FAILED', message: 'Validation failed', details });
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message = typeof res === 'string' ? res : ((res as { message?: string | string[] }).message ?? exception.message);
      return reply.status(status).send({ statusCode: status, code: STATUS_TO_CODE[status] ?? 'HTTP_ERROR', message: Array.isArray(message) ? message.join(', ') : message });
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({ statusCode: 500, code: 'INTERNAL', message: 'Internal server error' });
  }
}
```

`src/common/pagination.ts`:
```ts
export interface Pagination { page: number; pageSize: number; offset: number; limit: number }

export function parsePagination(q: { page?: number | string; pageSize?: number | string }): Pagination {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

export function paged<T>(data: T[], total: number, p: { page: number; pageSize: number }) {
  return { data, meta: { page: p.page, pageSize: p.pageSize, total } };
}
```

`src/common/zod.ts`:
```ts
import { z } from 'zod';

export const zUuid = z.string().uuid();
export const zPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
export const zPaginationQuery = z.object({
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
  sort: z.string().regex(/^[a-zA-Z]+:(asc|desc)$/).optional(),
});
export const periodToDate = (period: string) => `${period}-01`;
export const dateToPeriod = (date: string) => date.slice(0, 7);
```

Modify `src/app.module.ts` providers:
```ts
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';
// providers:
[{ provide: APP_PIPE, useClass: ZodValidationPipe }, { provide: APP_FILTER, useClass: HttpExceptionFilter }]
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/common`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add domain errors, exception filter and pagination helpers"
```

---

### Task 4: Auth module — login, refresh rotation, logout, guards

**Files:**
- Create: `src/common/auth/auth-user.ts`, `src/common/auth/public.decorator.ts`, `src/common/auth/roles.decorator.ts`, `src/common/auth/current-user.decorator.ts`, `src/common/auth/jwt-auth.guard.ts`, `src/common/auth/roles.guard.ts`
- Create: `src/auth/auth.module.ts`, `src/auth/auth.controller.ts`, `src/auth/auth.service.ts`, `src/auth/token.service.ts`, `src/auth/auth.dto.ts`
- Create: `test/helpers/factories.ts`, `test/auth.e2e.spec.ts`
- Modify: `src/app.module.ts` (AuthModule, APP_GUARD for JwtAuthGuard and RolesGuard), `src/main.ts` (rate limit on /auth)

**Interfaces:**
- Produces: `AuthUser = { id: string; role: UserRole; teamId: string | null }`; decorators `@Public()`, `@Roles(...roles)`, `@CurrentUser()`; `TokenService.issueAccessToken(user)`, `TokenService.createRefreshToken(userId, familyId?)`, `TokenService.rotateRefreshToken(raw)`, `TokenService.revokeRefreshToken(raw)`, `TokenService.createPasswordToken(userId, purpose)`, `TokenService.consumePasswordToken(raw, purpose)`; `AuthService.hashPassword(plain)`; test helpers `createUser(db, overrides)`, `login(app, email, password) → { accessToken, cookie }`.
- Endpoints: `POST /auth/login { email, password } → { data: { accessToken, user } }` + cookie; `POST /auth/refresh → { data: { accessToken } }` + new cookie; `POST /auth/logout → 204`.

- [ ] **Step 1: Install**

```bash
pnpm add @nestjs/jwt@^11 argon2@^0.41
```

- [ ] **Step 2: Write the test helpers and failing auth test**

`test/helpers/factories.ts`:
```ts
import { Db } from '@/database/drizzle.service';
import { users, teams, UserRole } from '@/database/schema';
import * as argon2 from 'argon2';

let counter = 0;

export async function createUser(db: Db, o: Partial<{ email: string; password: string; role: UserRole; teamId: string | null; firstName: string; lastName: string; isActive: boolean; employeeCode: string }> = {}) {
  counter += 1;
  const password = o.password ?? 'Password123!';
  const [u] = await db.insert(users).values({
    firstName: o.firstName ?? `User${counter}`,
    lastName: o.lastName ?? 'Test',
    email: o.email ?? `user${counter}@test.local`,
    passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    role: o.role ?? 'employee',
    teamId: o.teamId ?? null,
    isActive: o.isActive ?? true,
    employeeCode: o.employeeCode ?? `E${1000 + counter}`,
  }).returning();
  return { ...u, password };
}

export async function createTeam(db: Db, o: Partial<{ name: string; techLeadId: string | null }> = {}) {
  counter += 1;
  const [t] = await db.insert(teams).values({ name: o.name ?? `Team ${counter}`, techLeadId: o.techLeadId ?? null }).returning();
  return t;
}
```

Add to `test/helpers/app.ts`:
```ts
export async function login(app: NestFastifyApplication, email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'ot_refresh')!;
  return { accessToken: res.json().data.accessToken as string, cookie: `${cookie.name}=${cookie.value}` };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
```

`test/auth.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

describe('auth', () => {
  let app: NestFastifyApplication;
  let db: DrizzleService['db'];
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); });

  it('logs in with valid credentials and sets the refresh cookie', async () => {
    const u = await createUser(db, { email: 'a@t.local', password: 'Password123!' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'a@t.local', password: 'Password123!' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user).toMatchObject({ id: u.id, email: 'a@t.local', role: 'employee' });
    expect(res.json().data.accessToken).toBeTypeOf('string');
    const cookie = res.cookies.find((c) => c.name === 'ot_refresh');
    expect(cookie?.httpOnly).toBe(true);
  });

  it('rejects bad password with INVALID_CREDENTIALS', async () => {
    await createUser(db, { email: 'a@t.local' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'a@t.local', password: 'wrong-password' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects inactive users with USER_INACTIVE', async () => {
    const u = await createUser(db, { isActive: false });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: u.email, password: u.password } });
    expect(res.json().code).toBe('USER_INACTIVE');
  });

  it('protects routes and exposes /me', async () => {
    const u = await createUser(db);
    expect((await app.inject({ method: 'GET', url: '/api/v1/me' })).statusCode).toBe(401);
    const { accessToken } = await login(app, u.email, u.password);
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(u.id);
  });

  it('rotates the refresh token and revokes the family on reuse', async () => {
    const u = await createUser(db);
    const { cookie } = await login(app, u.email, u.password);
    const first = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie } });
    expect(first.statusCode).toBe(200);
    const second = res2cookie(first);
    // replay the original cookie
    const replay = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie } });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe('TOKEN_REUSED');
    // the rotated token is now dead too
    const after = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: second } });
    expect(after.statusCode).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const u = await createUser(db);
    const { cookie, accessToken } = await login(app, u.email, u.password);
    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie, ...bearer(accessToken) } });
    expect(out.statusCode).toBe(204);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });

  it('enforces @Roles on admin routes', async () => {
    const u = await createUser(db, { role: 'employee' });
    const { accessToken } = await login(app, u.email, u.password);
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: bearer(accessToken) });
    expect(res.statusCode).toBe(403);
  });
});

function res2cookie(res: { cookies: Array<{ name: string; value: string }> }) {
  const c = res.cookies.find((x) => x.name === 'ot_refresh')!;
  return `${c.name}=${c.value}`;
}
```
The `/me` and `/users` routes are implemented in Task 5. For this task, add a temporary `MeController` stub? No — implement `GET /me` here inside `AuthController` as `@Get('me')` mounted at root, and move it to `users/me.controller.ts` in Task 5. The `@Roles` test will pass once Task 5 adds `/users`; mark it `it.skip` until then and un-skip in Task 5.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run test/auth.e2e.spec.ts`
Expected: FAIL — 404 on `/auth/login`.

- [ ] **Step 4: Implement common auth pieces**

`src/common/auth/auth-user.ts`:
```ts
import { UserRole } from '@/database/schema';
export interface AuthUser { id: string; role: UserRole; teamId: string | null }
export const ADMIN: UserRole[] = ['admin'];
export const FINANCE_OR_ADMIN: UserRole[] = ['finance', 'admin'];
export const MANAGER_ROLES: UserRole[] = ['tech_lead', 'delivery_manager', 'cto', 'finance', 'admin'];
```

`src/common/auth/public.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
```

`src/common/auth/roles.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@/database/schema';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

`src/common/auth/current-user.decorator.ts`:
```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './auth-user';
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user as AuthUser;
});
```

`src/common/auth/jwt-auth.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { FastifyRequest } from 'fastify';
import { IS_PUBLIC } from './public.decorator';
import { DomainError } from '../errors/domain-error';
import { AuthUser } from './auth-user';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { user?: AuthUser }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new DomainError('UNAUTHORIZED', 'Missing bearer token', 401);
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: AuthUser['role']; teamId: string | null }>(token);
      req.user = { id: payload.sub, role: payload.role, teamId: payload.teamId ?? null };
      return true;
    } catch {
      throw new DomainError('TOKEN_EXPIRED', 'Invalid or expired token', 401);
    }
  }
}
```

`src/common/auth/roles.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { UserRole } from '@/database/schema';
import { AuthUser } from './auth-user';
import { forbidden } from '../errors/domain-error';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user || !roles.includes(user.role)) throw forbidden('Insufficient role');
    return true;
  }
}
```

- [ ] **Step 5: Implement TokenService**

`src/auth/token.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { refreshTokens, passwordTokens, users } from '@/database/schema';
import { Env } from '@/common/config/env';
import { DomainError } from '@/common/errors/domain-error';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class TokenService {
  constructor(private readonly drizzle: DrizzleService, private readonly jwt: JwtService, private readonly config: ConfigService<Env, true>) {}

  issueAccessToken(user: { id: string; role: string; teamId: string | null }): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, role: user.role, teamId: user.teamId }, { expiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS') });
  }

  async createRefreshToken(userId: string, familyId = randomUUID()): Promise<{ raw: string; expiresAt: Date }> {
    const raw = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + this.config.get('REFRESH_TTL_DAYS') * 86_400_000);
    await this.drizzle.db.insert(refreshTokens).values({ userId, familyId, tokenHash: sha256(raw), expiresAt });
    return { raw, expiresAt };
  }

  /** Rotates: revokes the presented token and issues a new one in the same family. Reuse of a revoked token kills the family. */
  async rotateRefreshToken(raw: string): Promise<{ raw: string; expiresAt: Date; user: typeof users.$inferSelect }> {
    const db = this.drizzle.db;
    const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw)));
    if (!row) throw new DomainError('TOKEN_INVALID', 'Unknown refresh token', 401);
    if (row.revokedAt) {
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
      throw new DomainError('TOKEN_REUSED', 'Refresh token reuse detected', 401);
    }
    if (row.expiresAt < new Date()) throw new DomainError('TOKEN_EXPIRED', 'Refresh token expired', 401);
    const [user] = await db.select().from(users).where(eq(users.id, row.userId));
    if (!user || !user.isActive) throw new DomainError('USER_INACTIVE', 'User is inactive', 401);
    const next = await this.createRefreshToken(row.userId, row.familyId);
    const [nextRow] = await db.select({ id: refreshTokens.id }).from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(next.raw)));
    await db.update(refreshTokens).set({ revokedAt: new Date(), replacedById: nextRow.id }).where(eq(refreshTokens.id, row.id));
    return { ...next, user };
  }

  async revokeRefreshToken(raw: string): Promise<void> {
    await this.drizzle.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, sha256(raw)));
  }

  async createPasswordToken(userId: string, purpose: 'invite' | 'reset'): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    const ttlMs = purpose === 'invite' ? 24 * 3_600_000 : 3_600_000;
    await this.drizzle.db.insert(passwordTokens).values({ userId, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs) });
    return raw;
  }

  async consumePasswordToken(raw: string, purpose: 'invite' | 'reset'): Promise<string> {
    const [row] = await this.drizzle.db.select().from(passwordTokens).where(and(eq(passwordTokens.tokenHash, sha256(raw)), eq(passwordTokens.purpose, purpose)));
    if (!row || row.usedAt) throw new DomainError('TOKEN_INVALID', 'Invalid token', 400);
    if (row.expiresAt < new Date()) throw new DomainError('TOKEN_EXPIRED', 'Token expired', 400);
    await this.drizzle.db.update(passwordTokens).set({ usedAt: new Date() }).where(eq(passwordTokens.id, row.id));
    return row.userId;
  }
}
```

- [ ] **Step 6: Implement AuthService, DTOs, controller, module**

`src/auth/auth.dto.ts`:
```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const zPassword = z.string().min(10, 'Password must be at least 10 characters').max(128);
export class LoginDto extends createZodDto(z.object({ email: z.string().email(), password: z.string().min(1) })) {}
export class AcceptInviteDto extends createZodDto(z.object({ token: z.string().min(10), password: zPassword })) {}
export class ForgotPasswordDto extends createZodDto(z.object({ email: z.string().email() })) {}
export class ResetPasswordDto extends createZodDto(z.object({ token: z.string().min(10), password: zPassword })) {}
```

`src/auth/auth.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { users } from '@/database/schema';
import { DomainError } from '@/common/errors/domain-error';
import { TokenService } from './token.service';

export type PublicUser = Omit<typeof users.$inferSelect, 'passwordHash'>;
export const toPublicUser = ({ passwordHash: _p, ...rest }: typeof users.$inferSelect): PublicUser => rest;

@Injectable()
export class AuthService {
  constructor(private readonly drizzle: DrizzleService, private readonly tokens: TokenService) {}

  static hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async login(email: string, password: string) {
    const [user] = await this.drizzle.db.select().from(users).where(eq(users.email, email.toLowerCase()));
    if (!user || !user.passwordHash || !(await argon2.verify(user.passwordHash, password))) {
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }
    if (!user.isActive) throw new DomainError('USER_INACTIVE', 'User is inactive', 401);
    const accessToken = await this.tokens.issueAccessToken(user);
    const refresh = await this.tokens.createRefreshToken(user.id);
    return { accessToken, refresh, user: toPublicUser(user) };
  }

  async refresh(raw: string) {
    const { user, ...refresh } = await this.tokens.rotateRefreshToken(raw);
    const accessToken = await this.tokens.issueAccessToken(user);
    return { accessToken, refresh };
  }

  async setPasswordByToken(raw: string, purpose: 'invite' | 'reset', password: string) {
    const userId = await this.tokens.consumePasswordToken(raw, purpose);
    await this.drizzle.db.update(users).set({ passwordHash: await AuthService.hashPassword(password), updatedAt: new Date() }).where(eq(users.id, userId));
  }

  async me(id: string): Promise<PublicUser> {
    const [user] = await this.drizzle.db.select().from(users).where(eq(users.id, id));
    if (!user) throw new DomainError('NOT_FOUND', 'User not found', 404);
    return toPublicUser(user);
  }
}
```

`src/auth/auth.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '@/common/auth/public.decorator';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { Env } from '@/common/config/env';
import { DomainError } from '@/common/errors/domain-error';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { AcceptInviteDto, ForgotPasswordDto, LoginDto, ResetPasswordDto } from './auth.dto';

export const REFRESH_COOKIE = 'ot_refresh';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly tokens: TokenService, private readonly config: ConfigService<Env, true>) {}

  private setRefreshCookie(reply: FastifyReply, raw: string, expiresAt: Date) {
    reply.setCookie(REFRESH_COOKIE, raw, { httpOnly: true, sameSite: 'lax', secure: this.config.get('NODE_ENV') === 'production', path: '/api/v1/auth', expires: expiresAt });
  }

  @Public() @Post('auth/login') @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const { accessToken, refresh, user } = await this.auth.login(dto.email, dto.password);
    this.setRefreshCookie(reply, refresh.raw, refresh.expiresAt);
    return { data: { accessToken, user } };
  }

  @Public() @Post('auth/refresh') @HttpCode(200)
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const raw = req.cookies[REFRESH_COOKIE];
    if (!raw) throw new DomainError('TOKEN_INVALID', 'Missing refresh cookie', 401);
    const { accessToken, refresh } = await this.auth.refresh(raw);
    this.setRefreshCookie(reply, refresh.raw, refresh.expiresAt);
    return { data: { accessToken } };
  }

  @Public() @Post('auth/logout') @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const raw = req.cookies[REFRESH_COOKIE];
    if (raw) await this.tokens.revokeRefreshToken(raw);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  @Public() @Post('auth/accept-invite') @HttpCode(204)
  async acceptInvite(@Body() dto: AcceptInviteDto) { await this.auth.setPasswordByToken(dto.token, 'invite', dto.password); }

  @Public() @Post('auth/reset-password') @HttpCode(204)
  async reset(@Body() dto: ResetPasswordDto) { await this.auth.setPasswordByToken(dto.token, 'reset', dto.password); }

  // forgot-password is wired in Task 5 once MailService exists; keep the signature stable.
  @Public() @Post('auth/forgot-password') @HttpCode(204)
  async forgot(@Body() _dto: ForgotPasswordDto) { return; }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) { return { data: await this.auth.me(user.id) }; }
}
```

`src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Env } from '@/common/config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.registerAsync({ global: true, inject: [ConfigService], useFactory: (c: ConfigService<Env, true>) => ({ secret: c.get('JWT_SECRET') }) })],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
```

Modify `src/app.module.ts`: import `AuthModule`; add providers `{ provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: RolesGuard }` (in that order, after the pipe and filter).

Modify `src/main.ts` `configureApp`, after the cookie registration:
```ts
import rateLimit from '@fastify/rate-limit';
await app.register(rateLimit, { global: false });
app.getHttpAdapter().getInstance().addHook('onRoute', (route) => {
  if (route.url.startsWith('/api/v1/auth/')) route.config = { ...(route.config ?? {}), rateLimit: { max: 10, timeWindow: '1 minute' } };
});
```
Note: the `onRoute` hook must be added before Nest registers routes, so call it at the top of `configureApp`, before `app.init()` runs in tests and before `listen()` in production. Place the `register(rateLimit)` and the hook as the first statements in `configureApp`.

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run test/auth.e2e.spec.ts`
Expected: PASS for all but the skipped `@Roles` test.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add auth module with JWT access tokens, rotating refresh cookies and role guards"
```

---

### Task 5: Mail service and Users module (CRUD, invite, password flows, /me)

**Files:**
- Create: `src/mail/mail.module.ts`, `src/mail/mail.service.ts`, `src/mail/templates.ts`
- Create: `src/users/users.module.ts`, `src/users/users.controller.ts`, `src/users/me.controller.ts`, `src/users/users.service.ts`, `src/users/users.dto.ts`
- Create: `test/users.e2e.spec.ts`
- Modify: `src/auth/auth.controller.ts` (remove `me`, wire forgot-password), `src/auth/auth.module.ts` (import MailModule), `src/app.module.ts` (UsersModule, MailModule), `test/auth.e2e.spec.ts` (un-skip roles test)

**Interfaces:**
- Produces: `MailService.send({ to, subject, html })` and `MailService.sent` (array populated in test env); templates `inviteEmail(name, link)`, `resetEmail(name, link)`; `UsersService.findById`, `list`, `create`, `update`, `deactivate`, `reactivate`, `resendInvite`, `changePassword`, `listFinance()`.
- Endpoints: `GET /users?search&role&isActive&page`, `POST /users`, `GET /users/:id`, `PATCH /users/:id`, `POST /users/:id/deactivate|reactivate|resend-invite` (admin); `GET /me`, `PATCH /me { firstName?, lastName?, timezone? }`, `POST /me/change-password { currentPassword, newPassword }`.

- [ ] **Step 1: Install**

```bash
pnpm add nodemailer@^7 && pnpm add -D @types/nodemailer
```

- [ ] **Step 2: Write the failing users test**

`test/users.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { MailService } from '@/mail/mail.service';

describe('users', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let mail: MailService;
  let admin: Awaited<ReturnType<typeof createUser>>; let adminToken: string;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; mail = app.get(MailService); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await truncateAll(db); mail.sent.length = 0;
    admin = await createUser(db, { role: 'admin', email: 'admin@t.local' });
    adminToken = (await login(app, admin.email, admin.password)).accessToken;
  });

  it('admin creates a user, which sends an invite that can be accepted', async () => {
    const team = await createTeam(db);
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: bearer(adminToken),
      payload: { firstName: 'Nora', lastName: 'K', email: 'Nora@T.local', role: 'employee', teamId: team.id, employeeCode: 'E42' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.email).toBe('nora@t.local');
    expect(mail.sent).toHaveLength(1);
    const token = mail.sent[0].html.match(/accept-invite\?token=([a-f0-9]+)/)![1];
    const accept = await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { token, password: 'NewPassword123' } });
    expect(accept.statusCode).toBe(204);
    const l = await login(app, 'nora@t.local', 'NewPassword123');
    expect(l.accessToken).toBeTypeOf('string');
    const reuse = await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { token, password: 'NewPassword123' } });
    expect(reuse.json().code).toBe('TOKEN_INVALID');
  });

  it('rejects duplicate email with EMAIL_TAKEN', async () => {
    await createUser(db, { email: 'dup@t.local' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: bearer(adminToken), payload: { firstName: 'A', lastName: 'B', email: 'dup@t.local', role: 'employee' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('EMAIL_TAKEN');
  });

  it('lists with search and filters, paginated', async () => {
    const team = await createTeam(db);
    for (let i = 0; i < 25; i++) await createUser(db, { firstName: i < 3 ? 'Zed' : 'Al', teamId: team.id });
    const res = await app.inject({ method: 'GET', url: '/api/v1/users?search=zed&pageSize=2', headers: bearer(adminToken) });
    expect(res.json().meta).toEqual({ page: 1, pageSize: 2, total: 3 });
    expect(res.json().data).toHaveLength(2);
    expect(res.json().data[0]).not.toHaveProperty('passwordHash');
  });

  it('deactivate blocks login; reactivate restores it', async () => {
    const u = await createUser(db);
    await app.inject({ method: 'POST', url: `/api/v1/users/${u.id}/deactivate`, headers: bearer(adminToken) });
    const l = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: u.email, password: u.password } });
    expect(l.json().code).toBe('USER_INACTIVE');
    await app.inject({ method: 'POST', url: `/api/v1/users/${u.id}/reactivate`, headers: bearer(adminToken) });
    expect((await login(app, u.email, u.password)).accessToken).toBeTypeOf('string');
  });

  it('forgot password emails a reset link that works once', async () => {
    const u = await createUser(db);
    const f = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: u.email } });
    expect(f.statusCode).toBe(204);
    const token = mail.sent[0].html.match(/reset-password\?token=([a-f0-9]+)/)![1];
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'AnotherPass123' } });
    expect(r.statusCode).toBe(204);
    expect((await login(app, u.email, 'AnotherPass123')).accessToken).toBeTypeOf('string');
    // unknown email still 204, no email
    mail.sent.length = 0;
    await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: 'ghost@t.local' } });
    expect(mail.sent).toHaveLength(0);
  });

  it('me: update profile and change password', async () => {
    const u = await createUser(db);
    const { accessToken } = await login(app, u.email, u.password);
    const p = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers: bearer(accessToken), payload: { timezone: 'Europe/Berlin' } });
    expect(p.json().data.timezone).toBe('Europe/Berlin');
    const bad = await app.inject({ method: 'POST', url: '/api/v1/me/change-password', headers: bearer(accessToken), payload: { currentPassword: 'nope-nope-nope', newPassword: 'FreshPass1234' } });
    expect(bad.json().code).toBe('INVALID_CREDENTIALS');
    const ok = await app.inject({ method: 'POST', url: '/api/v1/me/change-password', headers: bearer(accessToken), payload: { currentPassword: u.password, newPassword: 'FreshPass1234' } });
    expect(ok.statusCode).toBe(204);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run test/users.e2e.spec.ts`
Expected: FAIL — cannot find `@/mail/mail.service`.

- [ ] **Step 4: Implement MailModule**

`src/mail/templates.ts`:
```ts
const layout = (title: string, body: string, cta: { label: string; href: string }) => `<!doctype html>
<html><body style="font-family:Arial,sans-serif;background:#F8FAFC;padding:24px">
<div style="max-width:520px;margin:auto;background:#fff;border:1px solid #E4E7EB;border-radius:10px;padding:24px">
<h2 style="color:#1E3A5F;margin-top:0">${title}</h2><p style="color:#0F172A;line-height:1.5">${body}</p>
<p><a href="${cta.href}" style="display:inline-block;background:#1E3A5F;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${cta.label}</a></p>
<p style="color:#475569;font-size:12px">If the button does not work, open: ${cta.href}</p></div></body></html>`;

export const inviteEmail = (name: string, link: string) => ({ subject: 'You have been invited to OverTrack', html: layout(`Welcome, ${name}`, 'An account was created for you. Set your password to get started. The link is valid for 24 hours.', { label: 'Set password', href: link }) });
export const resetEmail = (name: string, link: string) => ({ subject: 'Reset your OverTrack password', html: layout(`Hi ${name}`, 'We received a request to reset your password. The link is valid for 1 hour. Ignore this email if you did not ask for it.', { label: 'Reset password', href: link }) });
export const genericEmail = (title: string, body: string, cta: { label: string; href: string }) => ({ subject: title, html: layout(title, body, cta) });
```

`src/mail/mail.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { Env } from '@/common/config/env';

export interface MailMessage { to: string; subject: string; html: string }

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  readonly sent: MailMessage[] = [];
  private readonly isTest: boolean;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.isTest = config.get('NODE_ENV') === 'test';
    this.transporter = this.isTest ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport(config.get('SMTP_URL'));
  }

  async send(msg: MailMessage): Promise<void> {
    if (this.isTest) { this.sent.push(msg); return; }
    try {
      await this.transporter.sendMail({ from: this.config.get('MAIL_FROM'), ...msg });
    } catch (err) {
      this.logger.error(`Failed to send "${msg.subject}" to ${msg.to}: ${(err as Error).message}`);
    }
  }
}
```

`src/mail/mail.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
```

- [ ] **Step 5: Implement UsersModule**

`src/users/users.dto.ts`:
```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { userRoleEnum } from '@/database/schema';
import { zPaginationQuery, zUuid } from '@/common/zod';
import { zPassword } from '@/auth/auth.dto';

const zRole = z.enum(userRoleEnum.enumValues);
export class CreateUserDto extends createZodDto(z.object({
  firstName: z.string().min(1).max(60), lastName: z.string().min(1).max(60), email: z.string().email(),
  role: zRole, teamId: zUuid.nullable().optional(), employeeCode: z.string().max(20).nullable().optional(), timezone: z.string().max(64).optional(),
})) {}
export class UpdateUserDto extends createZodDto(z.object({
  firstName: z.string().min(1).max(60).optional(), lastName: z.string().min(1).max(60).optional(), role: zRole.optional(),
  teamId: zUuid.nullable().optional(), employeeCode: z.string().max(20).nullable().optional(), timezone: z.string().max(64).optional(),
})) {}
export class ListUsersQueryDto extends createZodDto(zPaginationQuery.extend({
  search: z.string().optional(), role: zRole.optional(), teamId: zUuid.optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
})) {}
export class UpdateMeDto extends createZodDto(z.object({ firstName: z.string().min(1).max(60).optional(), lastName: z.string().min(1).max(60).optional(), timezone: z.string().max(64).optional() })) {}
export class ChangePasswordDto extends createZodDto(z.object({ currentPassword: z.string().min(1), newPassword: zPassword })) {}
```

`src/users/users.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { and, asc, count, eq, ilike, or, SQL } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { users } from '@/database/schema';
import { DomainError, notFound } from '@/common/errors/domain-error';
import { paged, parsePagination } from '@/common/pagination';
import { Env } from '@/common/config/env';
import { MailService } from '@/mail/mail.service';
import { inviteEmail, resetEmail } from '@/mail/templates';
import { TokenService } from '@/auth/token.service';
import { AuthService, PublicUser, toPublicUser } from '@/auth/auth.service';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './users.dto';

const PG_UNIQUE = '23505';

@Injectable()
export class UsersService {
  constructor(private readonly drizzle: DrizzleService, private readonly tokens: TokenService, private readonly mail: MailService, private readonly config: ConfigService<Env, true>) {}

  async findById(id: string): Promise<PublicUser> {
    const [u] = await this.drizzle.db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound('User');
    return toPublicUser(u);
  }

  async list(q: ListUsersQueryDto) {
    const p = parsePagination(q);
    const where: SQL[] = [];
    if (q.search) where.push(or(ilike(users.firstName, `%${q.search}%`), ilike(users.lastName, `%${q.search}%`), ilike(users.email, `%${q.search}%`))!);
    if (q.role) where.push(eq(users.role, q.role));
    if (q.teamId) where.push(eq(users.teamId, q.teamId));
    if (q.isActive !== undefined) where.push(eq(users.isActive, q.isActive));
    const cond = where.length ? and(...where) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      this.drizzle.db.select().from(users).where(cond).orderBy(asc(users.lastName), asc(users.firstName)).limit(p.limit).offset(p.offset),
      this.drizzle.db.select({ total: count() }).from(users).where(cond),
    ]);
    return paged(rows.map(toPublicUser), Number(total), p);
  }

  async create(dto: CreateUserDto): Promise<PublicUser> {
    const email = dto.email.toLowerCase();
    try {
      const [u] = await this.drizzle.db.insert(users).values({ ...dto, email, timezone: dto.timezone ?? this.config.get('DEFAULT_TIMEZONE') }).returning();
      await this.sendInvite(u);
      return toPublicUser(u);
    } catch (err) {
      throw this.mapUnique(err);
    }
  }

  async update(id: string, dto: UpdateUserDto): Promise<PublicUser> {
    try {
      const [u] = await this.drizzle.db.update(users).set({ ...dto, updatedAt: new Date() }).where(eq(users.id, id)).returning();
      if (!u) throw notFound('User');
      return toPublicUser(u);
    } catch (err) {
      throw this.mapUnique(err);
    }
  }

  async setActive(id: string, isActive: boolean): Promise<PublicUser> {
    const [u] = await this.drizzle.db.update(users).set({ isActive, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    if (!u) throw notFound('User');
    return toPublicUser(u);
  }

  async resendInvite(id: string): Promise<void> {
    const [u] = await this.drizzle.db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound('User');
    await this.sendInvite(u);
  }

  async forgotPassword(email: string): Promise<void> {
    const [u] = await this.drizzle.db.select().from(users).where(eq(users.email, email.toLowerCase()));
    if (!u || !u.isActive) return; // do not reveal existence
    const raw = await this.tokens.createPasswordToken(u.id, 'reset');
    await this.mail.send({ to: u.email, ...resetEmail(u.firstName, `${this.config.get('WEB_URL')}/reset-password?token=${raw}`) });
  }

  async updateMe(id: string, dto: { firstName?: string; lastName?: string; timezone?: string }): Promise<PublicUser> {
    return this.update(id, dto);
  }

  async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    const [u] = await this.drizzle.db.select().from(users).where(eq(users.id, id));
    if (!u?.passwordHash || !(await argon2.verify(u.passwordHash, currentPassword))) throw new DomainError('INVALID_CREDENTIALS', 'Current password is incorrect', 401);
    await this.drizzle.db.update(users).set({ passwordHash: await AuthService.hashPassword(newPassword), updatedAt: new Date() }).where(eq(users.id, id));
  }

  async listByRole(role: typeof users.$inferSelect.role): Promise<PublicUser[]> {
    const rows = await this.drizzle.db.select().from(users).where(and(eq(users.role, role), eq(users.isActive, true)));
    return rows.map(toPublicUser);
  }

  private async sendInvite(u: typeof users.$inferSelect) {
    const raw = await this.tokens.createPasswordToken(u.id, 'invite');
    await this.mail.send({ to: u.email, ...inviteEmail(u.firstName, `${this.config.get('WEB_URL')}/accept-invite?token=${raw}`) });
  }

  private mapUnique(err: unknown): unknown {
    const e = err as { code?: string; constraint?: string };
    if (e.code === PG_UNIQUE && e.constraint === 'users_email_idx') return new DomainError('EMAIL_TAKEN', 'Email already in use', 409);
    if (e.code === PG_UNIQUE && e.constraint === 'users_employee_code_idx') return new DomainError('EMPLOYEE_CODE_TAKEN', 'Employee code already in use', 409);
    return err;
  }
}
```

`src/users/users.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '@/common/auth/roles.decorator';
import { UsersService } from './users.service';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './users.dto';

@Controller('users')
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get() list(@Query() q: ListUsersQueryDto) { return this.users.list(q); }
  @Post() async create(@Body() dto: CreateUserDto) { return { data: await this.users.create(dto) }; }
  @Get(':id') async get(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.users.findById(id) }; }
  @Patch(':id') async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) { return { data: await this.users.update(id, dto) }; }
  @Post(':id/deactivate') @HttpCode(200) async deactivate(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.users.setActive(id, false) }; }
  @Post(':id/reactivate') @HttpCode(200) async reactivate(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.users.setActive(id, true) }; }
  @Post(':id/resend-invite') @HttpCode(204) async resend(@Param('id', ParseUUIDPipe) id: string) { await this.users.resendInvite(id); }
}
```

`src/users/me.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { UsersService } from './users.service';
import { ChangePasswordDto, UpdateMeDto } from './users.dto';

@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}
  @Get() async me(@CurrentUser() u: AuthUser) { return { data: await this.users.findById(u.id) }; }
  @Patch() async update(@CurrentUser() u: AuthUser, @Body() dto: UpdateMeDto) { return { data: await this.users.updateMe(u.id, dto) }; }
  @Post('change-password') @HttpCode(204) async changePassword(@CurrentUser() u: AuthUser, @Body() dto: ChangePasswordDto) { await this.users.changePassword(u.id, dto.currentPassword, dto.newPassword); }
}
```

`src/users/users.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { MeController } from './me.controller';

@Module({ imports: [AuthModule], controllers: [UsersController, MeController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
```

Modify `src/auth/auth.controller.ts`: delete the `me` handler and its `Get`/`CurrentUser`/`AuthUser` imports. Replace `forgot` with a delegation: inject `UsersService`? That creates a cycle (UsersModule imports AuthModule). Instead move the `forgot-password` route into a new `PasswordController` inside `users/`:

`src/users/password.controller.ts`:
```ts
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public } from '@/common/auth/public.decorator';
import { ForgotPasswordDto } from '@/auth/auth.dto';
import { UsersService } from './users.service';

@Controller('auth')
export class PasswordController {
  constructor(private readonly users: UsersService) {}
  @Public() @Post('forgot-password') @HttpCode(204)
  async forgot(@Body() dto: ForgotPasswordDto) { await this.users.forgotPassword(dto.email); }
}
```
Add `PasswordController` to `UsersModule.controllers` and delete the `forgot` stub from `AuthController`.

Modify `src/app.module.ts`: import `MailModule`, `AuthModule`, `UsersModule`.
Modify `test/auth.e2e.spec.ts`: change `it.skip` to `it` for the roles test.

- [ ] **Step 6: Run tests**

Run: `pnpm test`
Expected: PASS — auth (7), users (6), database, health, common.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add mail service and users module with invite and password flows"
```

---

### Task 6: Teams module

**Files:**
- Create: `src/teams/teams.module.ts`, `src/teams/teams.controller.ts`, `src/teams/teams.service.ts`, `src/teams/teams.dto.ts`
- Create: `test/teams.e2e.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Produces: `TeamsService.findById(id)`, `list(q)`, `create(dto)`, `update(id, dto)`, `members(id)`; `TeamSummary = team & { techLead: { id, firstName, lastName } | null, memberCount: number, chainStepCount: number }`.
- Endpoints: `GET /teams?search&isActive&page` (any authenticated user), `POST /teams`, `PATCH /teams/:id` (admin), `GET /teams/:id`, `GET /teams/:id/members`.

- [ ] **Step 1: Write the failing test**

`test/teams.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

describe('teams', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let adminToken: string; let employeeToken: string;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await truncateAll(db);
    const admin = await createUser(db, { role: 'admin' }); adminToken = (await login(app, admin.email, admin.password)).accessToken;
    const emp = await createUser(db); employeeToken = (await login(app, emp.email, emp.password)).accessToken;
  });

  it('admin creates and updates a team with a tech lead', async () => {
    const lead = await createUser(db, { role: 'tech_lead' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/teams', headers: bearer(adminToken), payload: { name: 'Platform', techLeadId: lead.id } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ name: 'Platform', techLead: { id: lead.id }, memberCount: 0, chainStepCount: 0 });
    const up = await app.inject({ method: 'PATCH', url: `/api/v1/teams/${res.json().data.id}`, headers: bearer(adminToken), payload: { description: 'Core infra' } });
    expect(up.json().data.description).toBe('Core infra');
  });

  it('rejects duplicate team names', async () => {
    await createTeam(db, { name: 'Platform' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/teams', headers: bearer(adminToken), payload: { name: 'Platform' } });
    expect(res.json().code).toBe('TEAM_NAME_TAKEN');
  });

  it('employees can list teams but not create them', async () => {
    await createTeam(db, { name: 'A' }); await createTeam(db, { name: 'B' });
    const list = await app.inject({ method: 'GET', url: '/api/v1/teams', headers: bearer(employeeToken) });
    expect(list.json().meta.total).toBe(2);
    const create = await app.inject({ method: 'POST', url: '/api/v1/teams', headers: bearer(employeeToken), payload: { name: 'C' } });
    expect(create.statusCode).toBe(403);
  });

  it('lists members', async () => {
    const t = await createTeam(db);
    await createUser(db, { teamId: t.id }); await createUser(db, { teamId: t.id }); await createUser(db);
    const res = await app.inject({ method: 'GET', url: `/api/v1/teams/${t.id}/members`, headers: bearer(employeeToken) });
    expect(res.json().data).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run test/teams.e2e.spec.ts` → FAIL 404.

- [ ] **Step 3: Implement**

`src/teams/teams.dto.ts`:
```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zPaginationQuery, zUuid } from '@/common/zod';

export class CreateTeamDto extends createZodDto(z.object({ name: z.string().min(1).max(80), description: z.string().max(500).nullable().optional(), techLeadId: zUuid.nullable().optional() })) {}
export class UpdateTeamDto extends createZodDto(z.object({ name: z.string().min(1).max(80).optional(), description: z.string().max(500).nullable().optional(), techLeadId: zUuid.nullable().optional(), isActive: z.boolean().optional() })) {}
export class ListTeamsQueryDto extends createZodDto(zPaginationQuery.extend({ search: z.string().optional(), isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional() })) {}
```

`src/teams/teams.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, SQL, sql } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { approvalChainSteps, teams, users } from '@/database/schema';
import { DomainError, notFound } from '@/common/errors/domain-error';
import { paged, parsePagination } from '@/common/pagination';
import { toPublicUser } from '@/auth/auth.service';
import { CreateTeamDto, ListTeamsQueryDto, UpdateTeamDto } from './teams.dto';

export interface TeamSummary {
  id: string; name: string; description: string | null; isActive: boolean; createdAt: Date; updatedAt: Date;
  techLead: { id: string; firstName: string; lastName: string } | null; memberCount: number; chainStepCount: number;
}

@Injectable()
export class TeamsService {
  constructor(private readonly drizzle: DrizzleService) {}

  private summaryQuery() {
    const db = this.drizzle.db;
    return db
      .select({
        id: teams.id, name: teams.name, description: teams.description, isActive: teams.isActive, createdAt: teams.createdAt, updatedAt: teams.updatedAt,
        techLeadId: users.id, techLeadFirst: users.firstName, techLeadLast: users.lastName,
        memberCount: sql<number>`(select count(*) from users m where m.team_id = ${teams.id} and m.is_active)`.mapWith(Number),
        chainStepCount: sql<number>`(select count(*) from approval_chain_steps s where s.team_id = ${teams.id})`.mapWith(Number),
      })
      .from(teams)
      .leftJoin(users, eq(users.id, teams.techLeadId));
  }

  private toSummary(r: Awaited<ReturnType<TeamsService['summaryQuery']>>[number]): TeamSummary {
    const { techLeadId, techLeadFirst, techLeadLast, ...rest } = r;
    return { ...rest, techLead: techLeadId ? { id: techLeadId, firstName: techLeadFirst!, lastName: techLeadLast! } : null };
  }

  async findById(id: string): Promise<TeamSummary> {
    const [r] = await this.summaryQuery().where(eq(teams.id, id));
    if (!r) throw notFound('Team');
    return this.toSummary(r);
  }

  async list(q: ListTeamsQueryDto) {
    const p = parsePagination(q);
    const where: SQL[] = [];
    if (q.search) where.push(ilike(teams.name, `%${q.search}%`));
    if (q.isActive !== undefined) where.push(eq(teams.isActive, q.isActive));
    const cond = where.length ? and(...where) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      this.summaryQuery().where(cond).orderBy(asc(teams.name)).limit(p.limit).offset(p.offset),
      this.drizzle.db.select({ total: count() }).from(teams).where(cond),
    ]);
    return paged(rows.map((r) => this.toSummary(r)), Number(total), p);
  }

  async create(dto: CreateTeamDto): Promise<TeamSummary> {
    try {
      const [t] = await this.drizzle.db.insert(teams).values(dto).returning({ id: teams.id });
      return this.findById(t.id);
    } catch (err) {
      throw this.mapUnique(err);
    }
  }

  async update(id: string, dto: UpdateTeamDto): Promise<TeamSummary> {
    try {
      const [t] = await this.drizzle.db.update(teams).set({ ...dto, updatedAt: new Date() }).where(eq(teams.id, id)).returning({ id: teams.id });
      if (!t) throw notFound('Team');
      return this.findById(t.id);
    } catch (err) {
      throw this.mapUnique(err);
    }
  }

  async members(id: string) {
    await this.findById(id);
    const rows = await this.drizzle.db.select().from(users).where(and(eq(users.teamId, id), eq(users.isActive, true))).orderBy(asc(users.lastName));
    return rows.map(toPublicUser);
  }

  async chainStepsOf(teamId: string) {
    return this.drizzle.db.select().from(approvalChainSteps).where(eq(approvalChainSteps.teamId, teamId)).orderBy(asc(approvalChainSteps.position));
  }

  private mapUnique(err: unknown): unknown {
    const e = err as { code?: string; constraint?: string };
    if (e.code === '23505' && e.constraint === 'teams_name_unique') return new DomainError('TEAM_NAME_TAKEN', 'Team name already in use', 409);
    return err;
  }
}
```

`src/teams/teams.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '@/common/auth/roles.decorator';
import { TeamsService } from './teams.service';
import { CreateTeamDto, ListTeamsQueryDto, UpdateTeamDto } from './teams.dto';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}
  @Get() list(@Query() q: ListTeamsQueryDto) { return this.teams.list(q); }
  @Get(':id') async get(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.teams.findById(id) }; }
  @Get(':id/members') async members(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.teams.members(id) }; }
  @Post() @Roles('admin') async create(@Body() dto: CreateTeamDto) { return { data: await this.teams.create(dto) }; }
  @Patch(':id') @Roles('admin') async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeamDto) { return { data: await this.teams.update(id, dto) }; }
}
```

`src/teams/teams.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
@Module({ controllers: [TeamsController], providers: [TeamsService], exports: [TeamsService] })
export class TeamsModule {}
```

Add `TeamsModule` to `AppModule` imports.

- [ ] **Step 4: Run tests** — `pnpm vitest run test/teams.e2e.spec.ts` → PASS (4).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add teams module"
```

---

### Task 7: Overtime types module

**Files:**
- Create: `src/overtime-types/overtime-types.module.ts`, `overtime-types.controller.ts`, `overtime-types.service.ts`, `overtime-types.dto.ts`
- Create: `test/overtime-types.e2e.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Produces: `OvertimeTypesService.list(includeInactive)`, `findActiveById(id)` (throws `NOT_FOUND` if missing or inactive), `create`, `update`, `ensureDefaults()` (inserts the four defaults if the table is empty). Row shape: `{ id, name, multiplier: number, color, sortOrder, isActive }`.
- Endpoints: `GET /overtime-types?includeInactive` (any user), `POST /overtime-types`, `PATCH /overtime-types/:id` (admin).

- [ ] **Step 1: Write the failing test**

`test/overtime-types.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { OvertimeTypesService } from '@/overtime-types/overtime-types.service';

describe('overtime types', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let adminToken: string; let empToken: string;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await truncateAll(db);
    const a = await createUser(db, { role: 'admin' }); adminToken = (await login(app, a.email, a.password)).accessToken;
    const e = await createUser(db); empToken = (await login(app, e.email, e.password)).accessToken;
  });

  it('ensureDefaults seeds four types once', async () => {
    const svc = app.get(OvertimeTypesService);
    await svc.ensureDefaults(); await svc.ensureDefaults();
    const res = await app.inject({ method: 'GET', url: '/api/v1/overtime-types', headers: bearer(empToken) });
    expect(res.json().data.map((t: { name: string; multiplier: number }) => [t.name, t.multiplier])).toEqual([
      ['Weekday extra hours', 1.5], ['Weekend', 2], ['Public holiday', 2.5], ['On-call / standby', 1],
    ]);
  });

  it('admin creates, updates, deactivates; inactive hidden by default', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/v1/overtime-types', headers: bearer(adminToken), payload: { name: 'Night shift', multiplier: 1.75, color: '#7C3AED' } });
    expect(c.statusCode).toBe(201);
    expect(c.json().data.multiplier).toBe(1.75);
    const id = c.json().data.id;
    await app.inject({ method: 'PATCH', url: `/api/v1/overtime-types/${id}`, headers: bearer(adminToken), payload: { isActive: false } });
    const visible = await app.inject({ method: 'GET', url: '/api/v1/overtime-types', headers: bearer(empToken) });
    expect(visible.json().data).toHaveLength(0);
    const all = await app.inject({ method: 'GET', url: '/api/v1/overtime-types?includeInactive=true', headers: bearer(adminToken) });
    expect(all.json().data).toHaveLength(1);
  });

  it('rejects multiplier <= 0 and non-admin writes', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/v1/overtime-types', headers: bearer(adminToken), payload: { name: 'X', multiplier: 0 } });
    expect(bad.json().code).toBe('VALIDATION_FAILED');
    const forb = await app.inject({ method: 'POST', url: '/api/v1/overtime-types', headers: bearer(empToken), payload: { name: 'X', multiplier: 1 } });
    expect(forb.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm vitest run test/overtime-types.e2e.spec.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/overtime-types/overtime-types.dto.ts`:
```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
const zHex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export class CreateOvertimeTypeDto extends createZodDto(z.object({ name: z.string().min(1).max(60), multiplier: z.number().gt(0).max(99.99), color: zHex.optional(), sortOrder: z.number().int().optional() })) {}
export class UpdateOvertimeTypeDto extends createZodDto(z.object({ name: z.string().min(1).max(60).optional(), multiplier: z.number().gt(0).max(99.99).optional(), color: zHex.optional(), sortOrder: z.number().int().optional(), isActive: z.boolean().optional() })) {}
export class ListOvertimeTypesQueryDto extends createZodDto(z.object({ includeInactive: z.enum(['true', 'false']).transform((v) => v === 'true').optional() })) {}
```

`src/overtime-types/overtime-types.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import { DrizzleService, DbOrTx } from '@/database/drizzle.service';
import { overtimeTypes } from '@/database/schema';
import { DomainError, notFound } from '@/common/errors/domain-error';
import { CreateOvertimeTypeDto, UpdateOvertimeTypeDto } from './overtime-types.dto';

export interface OvertimeType { id: string; name: string; multiplier: number; color: string; sortOrder: number; isActive: boolean }
const toType = (r: typeof overtimeTypes.$inferSelect): OvertimeType => ({ id: r.id, name: r.name, multiplier: Number(r.multiplier), color: r.color, sortOrder: r.sortOrder, isActive: r.isActive });

export const DEFAULT_OVERTIME_TYPES = [
  { name: 'Weekday extra hours', multiplier: '1.50', color: '#2563EB', sortOrder: 1 },
  { name: 'Weekend', multiplier: '2.00', color: '#7C3AED', sortOrder: 2 },
  { name: 'Public holiday', multiplier: '2.50', color: '#DB2777', sortOrder: 3 },
  { name: 'On-call / standby', multiplier: '1.00', color: '#059669', sortOrder: 4 },
];

@Injectable()
export class OvertimeTypesService {
  constructor(private readonly drizzle: DrizzleService) {}

  async list(includeInactive = false): Promise<OvertimeType[]> {
    const rows = await this.drizzle.db.select().from(overtimeTypes).where(includeInactive ? undefined : eq(overtimeTypes.isActive, true)).orderBy(asc(overtimeTypes.sortOrder), asc(overtimeTypes.name));
    return rows.map(toType);
  }

  async findActiveById(id: string, db: DbOrTx = this.drizzle.db): Promise<OvertimeType> {
    const [r] = await db.select().from(overtimeTypes).where(and(eq(overtimeTypes.id, id), eq(overtimeTypes.isActive, true)));
    if (!r) throw notFound('Overtime type');
    return toType(r);
  }

  async create(dto: CreateOvertimeTypeDto): Promise<OvertimeType> {
    try {
      const [r] = await this.drizzle.db.insert(overtimeTypes).values({ ...dto, multiplier: dto.multiplier.toFixed(2) }).returning();
      return toType(r);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new DomainError('CONFLICT', 'Overtime type name already exists', 409);
      throw err;
    }
  }

  async update(id: string, dto: UpdateOvertimeTypeDto): Promise<OvertimeType> {
    const { multiplier, ...rest } = dto;
    const [r] = await this.drizzle.db.update(overtimeTypes).set({ ...rest, ...(multiplier !== undefined ? { multiplier: multiplier.toFixed(2) } : {}), updatedAt: new Date() }).where(eq(overtimeTypes.id, id)).returning();
    if (!r) throw notFound('Overtime type');
    return toType(r);
  }

  async ensureDefaults(): Promise<void> {
    const [{ n }] = await this.drizzle.db.select({ n: count() }).from(overtimeTypes);
    if (Number(n) === 0) await this.drizzle.db.insert(overtimeTypes).values(DEFAULT_OVERTIME_TYPES);
  }
}
```

`src/overtime-types/overtime-types.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '@/common/auth/roles.decorator';
import { OvertimeTypesService } from './overtime-types.service';
import { CreateOvertimeTypeDto, ListOvertimeTypesQueryDto, UpdateOvertimeTypeDto } from './overtime-types.dto';

@Controller('overtime-types')
export class OvertimeTypesController {
  constructor(private readonly types: OvertimeTypesService) {}
  @Get() async list(@Query() q: ListOvertimeTypesQueryDto) { return { data: await this.types.list(q.includeInactive ?? false) }; }
  @Post() @Roles('admin') async create(@Body() dto: CreateOvertimeTypeDto) { return { data: await this.types.create(dto) }; }
  @Patch(':id') @Roles('admin') async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOvertimeTypeDto) { return { data: await this.types.update(id, dto) }; }
}
```

`src/overtime-types/overtime-types.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { OvertimeTypesService } from './overtime-types.service';
import { OvertimeTypesController } from './overtime-types.controller';
@Module({ controllers: [OvertimeTypesController], providers: [OvertimeTypesService], exports: [OvertimeTypesService] })
export class OvertimeTypesModule {}
```

Add to `AppModule` imports.

- [ ] **Step 4: Run tests** → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add overtime types module with default seeding"
```

---

### Task 8: Audit service and admin audit endpoint

**Files:**
- Create: `src/audit/audit.module.ts`, `src/audit/audit.service.ts`, `src/audit/audit.controller.ts`, `src/audit/audit.dto.ts`
- Create: `test/audit.e2e.spec.ts`
- Modify: `src/app.module.ts`, `src/users/users.service.ts`, `src/teams/teams.service.ts`, `src/overtime-types/overtime-types.service.ts` (record config changes)

**Interfaces:**
- Produces: `AuditService.record(db: DbOrTx, entry: { actorId: string | null; action: string; entityType: 'sheet' | 'user' | 'team' | 'chain' | 'overtime_type'; entityId: string; before?: unknown; after?: unknown; reason?: string | null })`; `AuditService.timelineForSheet(sheetId)`; `AuditService.list(q)`.
- Endpoint: `GET /admin/audit?entityType&entityId&actorId&from&to&page` (admin).
- Action naming convention: `<entity>.<verb>` e.g. `user.created`, `user.updated`, `user.deactivated`, `team.created`, `chain.replaced`, `overtime_type.updated`, `sheet.submitted`, `sheet.step_approved`, `sheet.approved`, `sheet.rejected`, `sheet.withdrawn`, `sheet.reopened`, `sheet.paid`, `sheet.payment_reverted`.

- [ ] **Step 1: Write the failing test**

`test/audit.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

describe('audit', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let admin: Awaited<ReturnType<typeof createUser>>; let adminToken: string;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); admin = await createUser(db, { role: 'admin' }); adminToken = (await login(app, admin.email, admin.password)).accessToken; });

  it('records admin config changes with actor, before and after', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/v1/teams', headers: bearer(adminToken), payload: { name: 'Ops' } });
    const id = c.json().data.id;
    await app.inject({ method: 'PATCH', url: `/api/v1/teams/${id}`, headers: bearer(adminToken), payload: { name: 'Operations' } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/admin/audit?entityType=team&entityId=${id}`, headers: bearer(adminToken) });
    expect(res.statusCode).toBe(200);
    const actions = res.json().data.map((r: { action: string }) => r.action);
    expect(actions).toEqual(['team.updated', 'team.created']);
    const updated = res.json().data[0];
    expect(updated.actor.id).toBe(admin.id);
    expect(updated.before.name).toBe('Ops');
    expect(updated.after.name).toBe('Operations');
  });

  it('is admin-only', async () => {
    const e = await createUser(db); const t = (await login(app, e.email, e.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/audit', headers: bearer(t) })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL 404.

- [ ] **Step 3: Implement**

`src/audit/audit.dto.ts`:
```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zPaginationQuery, zUuid } from '@/common/zod';
export class ListAuditQueryDto extends createZodDto(zPaginationQuery.extend({
  entityType: z.enum(['sheet', 'user', 'team', 'chain', 'overtime_type']).optional(), entityId: zUuid.optional(), actorId: zUuid.optional(),
  from: z.string().datetime().optional(), to: z.string().datetime().optional(),
})) {}
```

`src/audit/audit.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, lte, SQL } from 'drizzle-orm';
import { DrizzleService, DbOrTx } from '@/database/drizzle.service';
import { auditLog, users } from '@/database/schema';
import { paged, parsePagination } from '@/common/pagination';
import { ListAuditQueryDto } from './audit.dto';

export type AuditEntityType = 'sheet' | 'user' | 'team' | 'chain' | 'overtime_type';
export interface AuditEntry { actorId: string | null; action: string; entityType: AuditEntityType; entityId: string; before?: unknown; after?: unknown; reason?: string | null }

@Injectable()
export class AuditService {
  constructor(private readonly drizzle: DrizzleService) {}

  async record(db: DbOrTx, e: AuditEntry): Promise<void> {
    await db.insert(auditLog).values({ actorId: e.actorId, action: e.action, entityType: e.entityType, entityId: e.entityId, before: e.before ?? null, after: e.after ?? null, reason: e.reason ?? null });
  }

  private baseSelect() {
    return this.drizzle.db.select({
      id: auditLog.id, action: auditLog.action, entityType: auditLog.entityType, entityId: auditLog.entityId, before: auditLog.before, after: auditLog.after, reason: auditLog.reason, createdAt: auditLog.createdAt,
      actor: { id: users.id, firstName: users.firstName, lastName: users.lastName },
    }).from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId));
  }

  timelineForSheet(sheetId: string) {
    return this.baseSelect().where(and(eq(auditLog.entityType, 'sheet'), eq(auditLog.entityId, sheetId))).orderBy(asc(auditLog.createdAt));
  }

  async list(q: ListAuditQueryDto) {
    const p = parsePagination(q);
    const where: SQL[] = [];
    if (q.entityType) where.push(eq(auditLog.entityType, q.entityType));
    if (q.entityId) where.push(eq(auditLog.entityId, q.entityId));
    if (q.actorId) where.push(eq(auditLog.actorId, q.actorId));
    if (q.from) where.push(gte(auditLog.createdAt, new Date(q.from)));
    if (q.to) where.push(lte(auditLog.createdAt, new Date(q.to)));
    const cond = where.length ? and(...where) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      this.baseSelect().where(cond).orderBy(desc(auditLog.createdAt)).limit(p.limit).offset(p.offset),
      this.drizzle.db.select({ total: count() }).from(auditLog).where(cond),
    ]);
    return paged(rows.map((r) => ({ ...r, actor: r.actor?.id ? r.actor : null })), Number(total), p);
  }
}
```

`src/audit/audit.controller.ts`:
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '@/common/auth/roles.decorator';
import { AuditService } from './audit.service';
import { ListAuditQueryDto } from './audit.dto';

@Controller('admin/audit')
@Roles('admin')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get() list(@Query() q: ListAuditQueryDto) { return this.audit.list(q); }
}
```

`src/audit/audit.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
@Global()
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
```

Wire audit into existing admin mutations. Each admin controller method now needs the actor: add `@CurrentUser() actor: AuthUser` to `create`, `update`, `deactivate`, `reactivate` in `UsersController`, `create`/`update` in `TeamsController`, `create`/`update` in `OvertimeTypesController`, and pass `actor.id` as the first argument to the service methods. In each service inject `AuditService` and record:

- `UsersService.create(actorId, dto)`: after insert → `audit.record(db, { actorId, action: 'user.created', entityType: 'user', entityId: u.id, after: toPublicUser(u) })`.
- `UsersService.update(actorId, id, dto)`: select before, update, record `user.updated` with before/after public shapes.
- `UsersService.setActive(actorId, id, isActive)`: record `user.deactivated` / `user.reactivated`.
- `TeamsService.create(actorId, dto)`: `team.created` with `after` = summary. `update(actorId, id, dto)`: select before summary, record `team.updated`.
- `OvertimeTypesService.create(actorId, dto)` / `update(actorId, id, dto)`: `overtime_type.created` / `overtime_type.updated`.

Update the existing tests' service calls if they call services directly (they do not; they go through HTTP). `OvertimeTypesService.ensureDefaults()` records nothing.

Add `AuditModule` to `AppModule` imports.

- [ ] **Step 4: Run all tests** — `pnpm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add audit log service, admin audit endpoint and config-change auditing"
```

---

### Task 9: Sheets and entries (draft CRUD, validation, totals, visibility)

**Files:**
- Create: `src/sheets/sheets.module.ts`, `sheets.controller.ts`, `sheets.service.ts`, `entries.service.ts`, `visibility.service.ts`, `sheets.dto.ts`, `src/sheets/hours.ts`, `src/sheets/hours.spec.ts`
- Create: `test/sheets.e2e.spec.ts`
- Modify: `src/app.module.ts`, `test/helpers/factories.ts` (add `createOvertimeType`, `createEntry`)

**Interfaces:**
- Produces:
  - `hoursBetween('18:00','20:30') → 2.5`; `isQuarterStep(n)`; `weighted(hours, multiplier)` rounded to 2 dp.
  - `SheetsService.getOrCreateForPeriod(employeeId, period: 'YYYY-MM')`, `findDetail(id, actor)`, `list(q, actor)`, `lockForUpdate(tx, id)`, `recomputeTotals(tx, sheetId)`.
  - `EntriesService.create(actor, sheetId, dto)`, `update(actor, sheetId, entryId, dto)`, `remove(actor, sheetId, entryId)`.
  - `VisibilityService.visibleTeamIds(actor): Promise<string[] | 'all'>`, `canViewSheet(actor, sheet: { employeeId, teamId: string | null, id })`.
  - `SheetDetail` = `{ id, period, status, round, currentStepPosition, totalHours, totalWeightedHours, submittedAt, approvedAt, rejectedAt, rejectionReason, paidAt, paymentReference, version, employee: { id, firstName, lastName, employeeCode, teamId, teamName }, entries: EntryView[], steps: StepView[] }`; `EntryView = { id, date, startTime, endTime, hours, weightedHours, multiplier, overtimeType: { id, name, color }, workItem, workItemUrl, description, requestedBy: { id, firstName, lastName } | null, attachment: { id, originalName, mimeType, sizeBytes } | null }`; `StepView = { position, label, status, round, approver: {id, firstName, lastName}, backupApprover | null, decidedBy | null, decidedAt, comment, overrideReason }`.
- Endpoints: `GET /sheets?employeeId&period&status&teamId&page`, `GET /sheets/:id`, `POST /sheets/for-period { period }`, `POST /sheets/:id/entries`, `PATCH /sheets/:id/entries/:entryId`, `DELETE /sheets/:id/entries/:entryId`.

- [ ] **Step 1: Install and write the pure-helper tests**

```bash
pnpm add date-fns@^4 date-fns-tz@^3
```

`src/sheets/hours.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hoursBetween, isQuarterStep, weighted } from './hours';

describe('hours helpers', () => {
  it('computes hours between times rounded to quarter', () => {
    expect(hoursBetween('18:00', '20:30')).toBe(2.5);
    expect(hoursBetween('18:00', '18:10')).toBe(0.25);
    expect(hoursBetween('09:00', '09:00')).toBe(0);
    expect(hoursBetween('20:00', '18:00')).toBe(-2);
  });
  it('validates quarter steps', () => {
    expect(isQuarterStep(1.25)).toBe(true); expect(isQuarterStep(1.3)).toBe(false); expect(isQuarterStep(16)).toBe(true);
  });
  it('weights and rounds', () => { expect(weighted(2.5, 1.5)).toBe(3.75); expect(weighted(0.25, 2.5)).toBe(0.63); });
});
```

`src/sheets/hours.ts`:
```ts
const toMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const hoursBetween = (start: string, end: string): number => Math.round(((toMinutes(end) - toMinutes(start)) / 60) * 4) / 4 || 0;
export const isQuarterStep = (n: number): boolean => Number.isFinite(n) && Math.abs(n * 4 - Math.round(n * 4)) < 1e-9;
export const weighted = (hours: number, multiplier: number): number => Math.round(hours * multiplier * 100) / 100;
```
Run `pnpm vitest run src/sheets/hours.spec.ts` → PASS.

- [ ] **Step 2: Extend factories**

Append to `test/helpers/factories.ts`:
```ts
import { overtimeTypes, sheets, sheetEntries } from '@/database/schema';

export async function createOvertimeType(db: Db, o: Partial<{ name: string; multiplier: string }> = {}) {
  counter += 1;
  const [t] = await db.insert(overtimeTypes).values({ name: o.name ?? `Type ${counter}`, multiplier: o.multiplier ?? '1.50' }).returning();
  return t;
}

export async function createSheet(db: Db, employeeId: string, period = '2026-09') {
  const [s] = await db.insert(sheets).values({ employeeId, period: `${period}-01` }).returning();
  return s;
}

export async function createEntry(db: Db, sheetId: string, typeId: string, o: Partial<{ date: string; startTime: string; endTime: string; hours: string; multiplier: string }> = {}) {
  const hours = o.hours ?? '2.00'; const multiplier = o.multiplier ?? '1.50';
  const [e] = await db.insert(sheetEntries).values({
    sheetId, date: o.date ?? '2026-09-10', startTime: o.startTime ?? '18:00', endTime: o.endTime ?? '20:00', hours, overtimeTypeId: typeId,
    multiplierSnapshot: multiplier, weightedHours: (Number(hours) * Number(multiplier)).toFixed(2), workItem: 'PROJ-1', description: 'Did some overtime work',
  }).returning();
  return e;
}
```

- [ ] **Step 3: Write the failing e2e test**

`test/sheets.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { formatInTimeZone } from 'date-fns-tz';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam, createOvertimeType } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

const today = formatInTimeZone(new Date(), 'UTC', 'yyyy-MM-dd');
const thisPeriod = today.slice(0, 7);

describe('sheets and entries', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  let emp: Awaited<ReturnType<typeof createUser>>; let token: string; let typeId: string; let team: Awaited<ReturnType<typeof createTeam>>;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await truncateAll(db);
    team = await createTeam(db);
    emp = await createUser(db, { teamId: team.id }); token = (await login(app, emp.email, emp.password)).accessToken;
    typeId = (await createOvertimeType(db, { multiplier: '1.50' })).id;
  });

  const entry = (o: Record<string, unknown> = {}) => ({ date: today, startTime: '18:00', endTime: '20:30', overtimeTypeId: typeId, workItem: 'PROJ-12', description: 'Hotfix for payment service', ...o });

  async function sheetFor(period = thisPeriod) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/sheets/for-period', headers: bearer(token), payload: { period } });
    expect(res.statusCode).toBe(200);
    return res.json().data as { id: string; status: string; version: number };
  }

  it('for-period creates once and returns the same draft', async () => {
    const a = await sheetFor(); const b = await sheetFor();
    expect(a.id).toBe(b.id); expect(a.status).toBe('draft');
  });

  it('adds an entry, derives hours and weighted hours, recomputes totals', async () => {
    const s = await sheetFor();
    const res = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry() });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ hours: 2.5, multiplier: 1.5, weightedHours: 3.75, overtimeType: { id: typeId } });
    const d = await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.id}`, headers: bearer(token) });
    expect(d.json().data).toMatchObject({ totalHours: 2.5, totalWeightedHours: 3.75, employee: { id: emp.id, teamName: team.name } });
    expect(d.json().data.entries).toHaveLength(1);
  });

  it('rejects end before start, crossing midnight, and bad quarter steps', async () => {
    const s = await sheetFor();
    const r1 = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry({ startTime: '20:00', endTime: '18:00' }) });
    expect(r1.json().code).toBe('VALIDATION_FAILED');
    const r2 = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry({ startTime: '23:00', endTime: '01:00' }) });
    expect(r2.json().code).toBe('VALIDATION_FAILED');
    const r3 = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry({ hours: 1.3 }) });
    expect(r3.json().code).toBe('VALIDATION_FAILED');
  });

  it('rejects overlapping entries on the same date', async () => {
    const s = await sheetFor();
    await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry() });
    const r = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry({ startTime: '19:00', endTime: '21:00' }) });
    expect(r.statusCode).toBe(409); expect(r.json().code).toBe('ENTRY_OVERLAP');
    const ok = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry({ startTime: '20:30', endTime: '21:00' }) });
    expect(ok.statusCode).toBe(201);
  });

  it('rejects dates outside the period or in the future', async () => {
    const s = await sheetFor('2026-01');
    const out = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry({ date: '2026-02-01' }) });
    expect(out.json().code).toBe('ENTRY_OUT_OF_PERIOD');
    const cur = await sheetFor();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const fut = await app.inject({ method: 'POST', url: `/api/v1/sheets/${cur.id}/entries`, headers: bearer(token), payload: entry({ date: tomorrow }) });
    expect(['ENTRY_IN_FUTURE', 'ENTRY_OUT_OF_PERIOD']).toContain(fut.json().code);
  });

  it('updates and deletes entries, recomputing totals', async () => {
    const s = await sheetFor();
    const c = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(token), payload: entry() });
    const id = c.json().data.id;
    const u = await app.inject({ method: 'PATCH', url: `/api/v1/sheets/${s.id}/entries/${id}`, headers: bearer(token), payload: { endTime: '19:00' } });
    expect(u.json().data.hours).toBe(1);
    await app.inject({ method: 'DELETE', url: `/api/v1/sheets/${s.id}/entries/${id}`, headers: bearer(token) });
    const d = await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.id}`, headers: bearer(token) });
    expect(d.json().data.totalHours).toBe(0); expect(d.json().data.entries).toHaveLength(0);
  });

  it('other employees cannot see or edit my sheet; admin can see it', async () => {
    const s = await sheetFor();
    const other = await createUser(db); const ot = (await login(app, other.email, other.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.id}`, headers: bearer(ot) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(ot), payload: entry() })).statusCode).toBe(403);
    const admin = await createUser(db, { role: 'admin' }); const at = (await login(app, admin.email, admin.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.id}`, headers: bearer(at) })).statusCode).toBe(200);
    // admin cannot add entries to someone else's sheet either
    expect((await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.id}/entries`, headers: bearer(at), payload: entry() })).statusCode).toBe(403);
  });

  it('lists my sheets only, newest period first', async () => {
    await sheetFor('2026-01'); await sheetFor('2026-03');
    const other = await createUser(db); const ot = (await login(app, other.email, other.password)).accessToken;
    await app.inject({ method: 'POST', url: '/api/v1/sheets/for-period', headers: bearer(ot), payload: { period: '2026-02' } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/sheets', headers: bearer(token) });
    expect(res.json().data.map((s: { period: string }) => s.period)).toEqual(['2026-03', '2026-01']);
  });
});
```

- [ ] **Step 4: Run to verify it fails** → FAIL 404.

- [ ] **Step 5: Implement DTOs and VisibilityService**

`src/sheets/sheets.dto.ts`:
```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { sheetStatusEnum } from '@/database/schema';
import { zPaginationQuery, zPeriod, zUuid } from '@/common/zod';
import { hoursBetween, isQuarterStep } from './hours';

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const zHours = z.number().min(0.25).max(16).refine(isQuarterStep, 'Hours must be in 0.25 steps');

const entryBase = z.object({
  date: zDate, startTime: zTime, endTime: zTime, hours: zHours.optional(), overtimeTypeId: zUuid,
  workItem: z.string().min(1).max(120), workItemUrl: z.string().url().max(500).nullable().optional(),
  description: z.string().min(10).max(1000), requestedById: zUuid.nullable().optional(),
});
const timeOrder = (v: { startTime: string; endTime: string }) => hoursBetween(v.startTime, v.endTime) > 0;

export class CreateEntryDto extends createZodDto(entryBase.refine(timeOrder, { message: 'End time must be after start time on the same day', path: ['endTime'] })) {}
export class UpdateEntryDto extends createZodDto(entryBase.partial()) {}
export class ForPeriodDto extends createZodDto(z.object({ period: zPeriod })) {}
export class ListSheetsQueryDto extends createZodDto(zPaginationQuery.extend({
  employeeId: zUuid.optional(), teamId: zUuid.optional(), period: zPeriod.optional(), status: z.enum(sheetStatusEnum.enumValues).optional(),
})) {}
```

`src/sheets/visibility.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { approvalChainSteps, sheetApprovalSteps, teams } from '@/database/schema';
import { AuthUser } from '@/common/auth/auth-user';

@Injectable()
export class VisibilityService {
  constructor(private readonly drizzle: DrizzleService) {}

  /** Teams the actor may see consolidated data for. */
  async visibleTeamIds(actor: AuthUser): Promise<string[] | 'all'> {
    if (actor.role === 'admin' || actor.role === 'finance') return 'all';
    const db = this.drizzle.db;
    const [led, onChain] = await Promise.all([
      db.select({ id: teams.id }).from(teams).where(eq(teams.techLeadId, actor.id)),
      db.selectDistinct({ id: approvalChainSteps.teamId }).from(approvalChainSteps).where(or(eq(approvalChainSteps.approverId, actor.id), eq(approvalChainSteps.backupApproverId, actor.id))),
    ]);
    return [...new Set([...led, ...onChain].map((r) => r.id))];
  }

  async canViewSheet(actor: AuthUser, sheet: { id: string; employeeId: string; teamId: string | null }): Promise<boolean> {
    if (sheet.employeeId === actor.id) return true;
    const visible = await this.visibleTeamIds(actor);
    if (visible === 'all') return true;
    if (sheet.teamId && visible.includes(sheet.teamId)) return true;
    // approvers named on the sheet's own snapshot (the team chain may have changed since submission)
    const [named] = await this.drizzle.db.select({ id: sheetApprovalSteps.id }).from(sheetApprovalSteps)
      .where(and(eq(sheetApprovalSteps.sheetId, sheet.id), or(eq(sheetApprovalSteps.approverId, actor.id), eq(sheetApprovalSteps.backupApproverId, actor.id))))
      .limit(1);
    return Boolean(named);
  }
}
```

- [ ] **Step 6: Implement SheetsService**

`src/sheets/sheets.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, count, desc, eq, inArray, sql, SQL, sum } from 'drizzle-orm';
import { DrizzleService, DbOrTx, Tx } from '@/database/drizzle.service';
import { attachments, overtimeTypes, sheetApprovalSteps, sheetEntries, sheets, teams, users } from '@/database/schema';
import { AuthUser } from '@/common/auth/auth-user';
import { forbidden, notFound } from '@/common/errors/domain-error';
import { paged, parsePagination } from '@/common/pagination';
import { dateToPeriod, periodToDate } from '@/common/zod';
import { ListSheetsQueryDto } from './sheets.dto';
import { VisibilityService } from './visibility.service';

export type SheetRow = typeof sheets.$inferSelect;
const person = { id: users.id, firstName: users.firstName, lastName: users.lastName };

export interface SheetSummary {
  id: string; period: string; status: SheetRow['status']; round: number; currentStepPosition: number | null; totalHours: number; totalWeightedHours: number;
  submittedAt: Date | null; approvedAt: Date | null; rejectedAt: Date | null; rejectionReason: string | null; paidAt: Date | null; paymentReference: string | null; version: number;
  employee: { id: string; firstName: string; lastName: string; employeeCode: string | null; teamId: string | null; teamName: string | null };
}

@Injectable()
export class SheetsService {
  constructor(private readonly drizzle: DrizzleService, private readonly visibility: VisibilityService) {}

  private summarySelect(db: DbOrTx) {
    return db.select({
      sheet: sheets,
      employee: { id: users.id, firstName: users.firstName, lastName: users.lastName, employeeCode: users.employeeCode, teamId: users.teamId, teamName: teams.name },
    }).from(sheets).innerJoin(users, eq(users.id, sheets.employeeId)).leftJoin(teams, eq(teams.id, users.teamId));
  }

  static toSummary(r: { sheet: SheetRow; employee: SheetSummary['employee'] }): SheetSummary {
    const s = r.sheet;
    return {
      id: s.id, period: dateToPeriod(s.period), status: s.status, round: s.round, currentStepPosition: s.currentStepPosition,
      totalHours: Number(s.totalHours), totalWeightedHours: Number(s.totalWeightedHours), submittedAt: s.submittedAt, approvedAt: s.approvedAt,
      rejectedAt: s.rejectedAt, rejectionReason: s.rejectionReason, paidAt: s.paidAt, paymentReference: s.paymentReference, version: s.version, employee: r.employee,
    };
  }

  async getOrCreateForPeriod(employeeId: string, period: string): Promise<SheetSummary> {
    const db = this.drizzle.db;
    await db.insert(sheets).values({ employeeId, period: periodToDate(period) }).onConflictDoNothing();
    const [r] = await this.summarySelect(db).where(and(eq(sheets.employeeId, employeeId), eq(sheets.period, periodToDate(period))));
    return SheetsService.toSummary(r);
  }

  async findRaw(id: string, db: DbOrTx = this.drizzle.db) {
    const [r] = await this.summarySelect(db).where(eq(sheets.id, id));
    if (!r) throw notFound('Sheet');
    return r;
  }

  async lockForUpdate(tx: Tx, id: string): Promise<SheetRow> {
    const [row] = await tx.select().from(sheets).where(eq(sheets.id, id)).for('update');
    if (!row) throw notFound('Sheet');
    return row;
  }

  async assertCanView(actor: AuthUser, id: string) {
    const r = await this.findRaw(id);
    if (!(await this.visibility.canViewSheet(actor, { id: r.sheet.id, employeeId: r.sheet.employeeId, teamId: r.employee.teamId }))) throw forbidden('You cannot view this sheet');
    return r;
  }

  async findDetail(id: string, actor: AuthUser) {
    const r = await this.assertCanView(actor, id);
    const [entries, steps] = await Promise.all([this.entriesOf(id), this.stepsOf(id, r.sheet.round)]);
    return { ...SheetsService.toSummary(r), entries, steps };
  }

  async entriesOf(sheetId: string, db: DbOrTx = this.drizzle.db) {
    const requester = alias(users, 'requester');
    const rows = await db.select({
      e: sheetEntries, type: { id: overtimeTypes.id, name: overtimeTypes.name, color: overtimeTypes.color },
      requestedBy: { id: requester.id, firstName: requester.firstName, lastName: requester.lastName },
      attachment: { id: attachments.id, originalName: attachments.originalName, mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes },
    }).from(sheetEntries)
      .innerJoin(overtimeTypes, eq(overtimeTypes.id, sheetEntries.overtimeTypeId))
      .leftJoin(requester, eq(requester.id, sheetEntries.requestedById))
      .leftJoin(attachments, eq(attachments.id, sheetEntries.attachmentId))
      .where(eq(sheetEntries.sheetId, sheetId)).orderBy(asc(sheetEntries.date), asc(sheetEntries.startTime));
    return rows.map(SheetsService.toEntryView);
  }

  static toEntryView(r: { e: typeof sheetEntries.$inferSelect; type: { id: string; name: string; color: string }; requestedBy: { id: string | null; firstName: string | null; lastName: string | null } | null; attachment: { id: string | null; originalName: string | null; mimeType: string | null; sizeBytes: number | null } | null }) {
    const { e } = r;
    return {
      id: e.id, date: e.date, startTime: e.startTime.slice(0, 5), endTime: e.endTime.slice(0, 5), hours: Number(e.hours), multiplier: Number(e.multiplierSnapshot), weightedHours: Number(e.weightedHours),
      overtimeType: r.type, workItem: e.workItem, workItemUrl: e.workItemUrl, description: e.description,
      requestedBy: r.requestedBy?.id ? (r.requestedBy as { id: string; firstName: string; lastName: string }) : null,
      attachment: r.attachment?.id ? (r.attachment as { id: string; originalName: string; mimeType: string; sizeBytes: number }) : null,
    };
  }

  async stepsOf(sheetId: string, round: number, db: DbOrTx = this.drizzle.db) {
    const approver = alias(users, 'approver'); const backup = alias(users, 'backup'); const decider = alias(users, 'decider');
    const rows = await db.select({
      s: sheetApprovalSteps,
      approver: { id: approver.id, firstName: approver.firstName, lastName: approver.lastName },
      backup: { id: backup.id, firstName: backup.firstName, lastName: backup.lastName },
      decidedBy: { id: decider.id, firstName: decider.firstName, lastName: decider.lastName },
    }).from(sheetApprovalSteps)
      .innerJoin(approver, eq(approver.id, sheetApprovalSteps.approverId))
      .leftJoin(backup, eq(backup.id, sheetApprovalSteps.backupApproverId))
      .leftJoin(decider, eq(decider.id, sheetApprovalSteps.decidedById))
      .where(and(eq(sheetApprovalSteps.sheetId, sheetId), eq(sheetApprovalSteps.round, round))).orderBy(asc(sheetApprovalSteps.position));
    return rows.map((r) => ({
      position: r.s.position, label: r.s.label, status: r.s.status, round: r.s.round, approver: r.approver,
      backupApprover: r.backup?.id ? r.backup : null, decidedBy: r.decidedBy?.id ? r.decidedBy : null, decidedAt: r.s.decidedAt, comment: r.s.comment, overrideReason: r.s.overrideReason,
    }));
  }

  async list(q: ListSheetsQueryDto, actor: AuthUser) {
    const p = parsePagination(q);
    const where: SQL[] = [];
    const visible = await this.visibility.visibleTeamIds(actor);
    if (visible === 'all') {
      if (q.employeeId) where.push(eq(sheets.employeeId, q.employeeId));
    } else {
      const own = eq(sheets.employeeId, actor.id);
      if (q.employeeId && q.employeeId !== actor.id) {
        if (visible.length === 0) throw forbidden();
        where.push(and(eq(sheets.employeeId, q.employeeId), inArray(users.teamId, visible))!);
      } else if (!q.employeeId && visible.length > 0) {
        where.push(sql`(${own} or ${inArray(users.teamId, visible)})`);
      } else {
        where.push(own);
      }
    }
    if (q.teamId) where.push(eq(users.teamId, q.teamId));
    if (q.period) where.push(eq(sheets.period, periodToDate(q.period)));
    if (q.status) where.push(eq(sheets.status, q.status));
    const cond = where.length ? and(...where) : undefined;
    const base = this.drizzle.db.select({ total: count() }).from(sheets).innerJoin(users, eq(users.id, sheets.employeeId)).where(cond);
    const [rows, [{ total }]] = await Promise.all([
      this.summarySelect(this.drizzle.db).where(cond).orderBy(desc(sheets.period), asc(users.lastName)).limit(p.limit).offset(p.offset), base,
    ]);
    return paged(rows.map(SheetsService.toSummary), Number(total), p);
  }

  async recomputeTotals(tx: DbOrTx, sheetId: string): Promise<void> {
    const [t] = await tx.select({ h: sum(sheetEntries.hours), w: sum(sheetEntries.weightedHours) }).from(sheetEntries).where(eq(sheetEntries.sheetId, sheetId));
    await tx.update(sheets).set({ totalHours: t.h ?? '0', totalWeightedHours: t.w ?? '0', updatedAt: new Date() }).where(eq(sheets.id, sheetId));
  }
}
```

- [ ] **Step 7: Implement EntriesService, controller, module**

`src/sheets/entries.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { and, eq, gt, lt, ne } from 'drizzle-orm';
import { formatInTimeZone } from 'date-fns-tz';
import { DrizzleService, DbOrTx } from '@/database/drizzle.service';
import { sheetEntries, users } from '@/database/schema';
import { AuthUser } from '@/common/auth/auth-user';
import { DomainError, forbidden, notFound } from '@/common/errors/domain-error';
import { OvertimeTypesService } from '@/overtime-types/overtime-types.service';
import { SheetsService } from './sheets.service';
import { CreateEntryDto, UpdateEntryDto } from './sheets.dto';
import { hoursBetween, weighted } from './hours';

const EDITABLE = new Set(['draft', 'rejected']);

@Injectable()
export class EntriesService {
  constructor(private readonly drizzle: DrizzleService, private readonly sheets: SheetsService, private readonly types: OvertimeTypesService) {}

  private async editableSheet(tx: DbOrTx, actor: AuthUser, sheetId: string) {
    const r = await this.sheets.findRaw(sheetId, tx);
    if (r.sheet.employeeId !== actor.id) throw forbidden('Only the sheet owner can edit entries');
    if (!EDITABLE.has(r.sheet.status)) throw new DomainError('SHEET_NOT_EDITABLE', `Sheet is ${r.sheet.status} and cannot be edited`, 409);
    return r;
  }

  private async validateDate(tx: DbOrTx, employeeId: string, period: string, date: string) {
    if (!date.startsWith(period.slice(0, 7))) throw new DomainError('ENTRY_OUT_OF_PERIOD', 'Date is outside the sheet period', 400);
    const [u] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, employeeId));
    const today = formatInTimeZone(new Date(), u?.tz ?? 'UTC', 'yyyy-MM-dd');
    if (date > today) throw new DomainError('ENTRY_IN_FUTURE', 'Date cannot be in the future', 400);
  }

  private async assertNoOverlap(tx: DbOrTx, sheetId: string, date: string, start: string, end: string, excludeId?: string) {
    const conds = [eq(sheetEntries.sheetId, sheetId), eq(sheetEntries.date, date), lt(sheetEntries.startTime, end), gt(sheetEntries.endTime, start)];
    if (excludeId) conds.push(ne(sheetEntries.id, excludeId));
    const [clash] = await tx.select({ id: sheetEntries.id }).from(sheetEntries).where(and(...conds)).limit(1);
    if (clash) throw new DomainError('ENTRY_OVERLAP', 'Overlaps an existing entry on the same date', 409);
  }

  async create(actor: AuthUser, sheetId: string, dto: CreateEntryDto) {
    return this.drizzle.db.transaction(async (tx) => {
      const { sheet } = await this.editableSheet(tx, actor, sheetId);
      await this.validateDate(tx, sheet.employeeId, sheet.period, dto.date);
      await this.assertNoOverlap(tx, sheetId, dto.date, dto.startTime, dto.endTime);
      const type = await this.types.findActiveById(dto.overtimeTypeId, tx);
      const hours = dto.hours ?? hoursBetween(dto.startTime, dto.endTime);
      const [row] = await tx.insert(sheetEntries).values({
        sheetId, date: dto.date, startTime: dto.startTime, endTime: dto.endTime, hours: hours.toFixed(2), overtimeTypeId: type.id,
        multiplierSnapshot: type.multiplier.toFixed(2), weightedHours: weighted(hours, type.multiplier).toFixed(2),
        workItem: dto.workItem, workItemUrl: dto.workItemUrl ?? null, description: dto.description, requestedById: dto.requestedById ?? null,
      }).returning({ id: sheetEntries.id });
      await this.sheets.recomputeTotals(tx, sheetId);
      const [view] = (await this.sheets.entriesOf(sheetId, tx)).filter((e) => e.id === row.id);
      return view;
    });
  }

  async update(actor: AuthUser, sheetId: string, entryId: string, dto: UpdateEntryDto) {
    return this.drizzle.db.transaction(async (tx) => {
      const { sheet } = await this.editableSheet(tx, actor, sheetId);
      const [cur] = await tx.select().from(sheetEntries).where(and(eq(sheetEntries.id, entryId), eq(sheetEntries.sheetId, sheetId)));
      if (!cur) throw notFound('Entry');
      const date = dto.date ?? cur.date; const start = dto.startTime ?? cur.startTime.slice(0, 5); const end = dto.endTime ?? cur.endTime.slice(0, 5);
      if (hoursBetween(start, end) <= 0) throw new DomainError('VALIDATION_FAILED', 'End time must be after start time', 400, [{ path: 'endTime', message: 'End time must be after start time' }]);
      await this.validateDate(tx, sheet.employeeId, sheet.period, date);
      await this.assertNoOverlap(tx, sheetId, date, start, end, entryId);
      const type = dto.overtimeTypeId ? await this.types.findActiveById(dto.overtimeTypeId, tx) : { id: cur.overtimeTypeId, multiplier: Number(cur.multiplierSnapshot) };
      const timesChanged = dto.startTime !== undefined || dto.endTime !== undefined;
      const hours = dto.hours ?? (timesChanged ? hoursBetween(start, end) : Number(cur.hours));
      await tx.update(sheetEntries).set({
        date, startTime: start, endTime: end, hours: hours.toFixed(2), overtimeTypeId: type.id, multiplierSnapshot: type.multiplier.toFixed(2),
        weightedHours: weighted(hours, type.multiplier).toFixed(2),
        workItem: dto.workItem ?? cur.workItem, workItemUrl: dto.workItemUrl === undefined ? cur.workItemUrl : dto.workItemUrl,
        description: dto.description ?? cur.description, requestedById: dto.requestedById === undefined ? cur.requestedById : dto.requestedById, updatedAt: new Date(),
      }).where(eq(sheetEntries.id, entryId));
      await this.sheets.recomputeTotals(tx, sheetId);
      return (await this.sheets.entriesOf(sheetId, tx)).find((e) => e.id === entryId)!;
    });
  }

  async remove(actor: AuthUser, sheetId: string, entryId: string): Promise<void> {
    await this.drizzle.db.transaction(async (tx) => {
      await this.editableSheet(tx, actor, sheetId);
      const deleted = await tx.delete(sheetEntries).where(and(eq(sheetEntries.id, entryId), eq(sheetEntries.sheetId, sheetId))).returning({ id: sheetEntries.id });
      if (deleted.length === 0) throw notFound('Entry');
      await this.sheets.recomputeTotals(tx, sheetId);
    });
  }
}
```

`src/sheets/sheets.controller.ts`:
```ts
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { SheetsService } from './sheets.service';
import { EntriesService } from './entries.service';
import { CreateEntryDto, ForPeriodDto, ListSheetsQueryDto, UpdateEntryDto } from './sheets.dto';

@Controller('sheets')
export class SheetsController {
  constructor(private readonly sheets: SheetsService, private readonly entries: EntriesService) {}

  @Get() list(@Query() q: ListSheetsQueryDto, @CurrentUser() actor: AuthUser) { return this.sheets.list(q, actor); }
  @Post('for-period') @HttpCode(200) async forPeriod(@Body() dto: ForPeriodDto, @CurrentUser() actor: AuthUser) { return { data: await this.sheets.getOrCreateForPeriod(actor.id, dto.period) }; }
  @Get(':id') async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) { return { data: await this.sheets.findDetail(id, actor) }; }
  @Post(':id/entries') async addEntry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateEntryDto, @CurrentUser() actor: AuthUser) { return { data: await this.entries.create(actor, id, dto) }; }
  @Patch(':id/entries/:entryId') async updateEntry(@Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string, @Body() dto: UpdateEntryDto, @CurrentUser() actor: AuthUser) { return { data: await this.entries.update(actor, id, entryId, dto) }; }
  @Delete(':id/entries/:entryId') @HttpCode(204) async removeEntry(@Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string, @CurrentUser() actor: AuthUser) { await this.entries.remove(actor, id, entryId); }
}
```

`src/sheets/sheets.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { OvertimeTypesModule } from '@/overtime-types/overtime-types.module';
import { SheetsController } from './sheets.controller';
import { SheetsService } from './sheets.service';
import { EntriesService } from './entries.service';
import { VisibilityService } from './visibility.service';
@Module({ imports: [OvertimeTypesModule], controllers: [SheetsController], providers: [SheetsService, EntriesService, VisibilityService], exports: [SheetsService, VisibilityService] })
export class SheetsModule {}
```

Add `SheetsModule` to `AppModule`.

- [ ] **Step 8: Run tests** — `pnpm vitest run test/sheets.e2e.spec.ts src/sheets` → PASS (8 + 3).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: add sheets and entries with validation, totals and visibility rules"
```

---

### Task 10: Attachments (upload, download, delete)

**Files:**
- Create: `src/attachments/attachments.module.ts`, `attachments.controller.ts`, `attachments.service.ts`, `storage.service.ts`
- Create: `test/attachments.e2e.spec.ts`
- Modify: `src/main.ts` (register `@fastify/multipart`), `src/app.module.ts`

**Interfaces:**
- Produces: `StorageService.save(buffer, ext) → storageKey`, `StorageService.stream(storageKey)`, `StorageService.remove(storageKey)`; `AttachmentsService.attachToEntry(actor, sheetId, entryId, file)`, `detach(actor, sheetId, entryId)`, `open(actor, attachmentId) → { stream, mimeType, originalName }`.
- Endpoints: `POST /sheets/:id/entries/:entryId/attachment` (multipart field `file`), `DELETE /sheets/:id/entries/:entryId/attachment`, `GET /attachments/:id`.

- [ ] **Step 1: Write the failing test**

`test/attachments.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createOvertimeType, createSheet, createEntry } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

function multipart(fields: { name: string; filename: string; type: string; data: Buffer }) {
  const boundary = '----overtrack';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fields.name}"; filename="${fields.filename}"\r\nContent-Type: ${fields.type}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, fields.data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('attachments', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let token: string; let sheetId: string; let entryId: string;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await truncateAll(db);
    const emp = await createUser(db); token = (await login(app, emp.email, emp.password)).accessToken;
    const type = await createOvertimeType(db); const sheet = await createSheet(db, emp.id); sheetId = sheet.id;
    entryId = (await createEntry(db, sheetId, type.id)).id;
  });

  it('uploads a png, lists it on the entry, downloads it, deletes it', async () => {
    const m = multipart({ name: 'file', filename: 'proof.png', type: 'image/png', data: PNG });
    const up = await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheetId}/entries/${entryId}/attachment`, headers: { ...bearer(token), ...m.headers }, payload: m.payload });
    expect(up.statusCode).toBe(201);
    const att = up.json().data; expect(att).toMatchObject({ originalName: 'proof.png', mimeType: 'image/png', sizeBytes: PNG.length });
    const detail = await app.inject({ method: 'GET', url: `/api/v1/sheets/${sheetId}`, headers: bearer(token) });
    expect(detail.json().data.entries[0].attachment.id).toBe(att.id);
    const dl = await app.inject({ method: 'GET', url: `/api/v1/attachments/${att.id}`, headers: bearer(token) });
    expect(dl.statusCode).toBe(200); expect(dl.headers['content-type']).toBe('image/png'); expect(dl.rawPayload.equals(PNG)).toBe(true);
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/sheets/${sheetId}/entries/${entryId}/attachment`, headers: bearer(token) });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/v1/attachments/${att.id}`, headers: bearer(token) })).statusCode).toBe(404);
  });

  it('rejects disallowed types and a second attachment', async () => {
    const bad = multipart({ name: 'file', filename: 'x.exe', type: 'application/octet-stream', data: PNG });
    const r = await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheetId}/entries/${entryId}/attachment`, headers: { ...bearer(token), ...bad.headers }, payload: bad.payload });
    expect(r.json().code).toBe('ATTACHMENT_TYPE');
    const ok = multipart({ name: 'file', filename: 'a.png', type: 'image/png', data: PNG });
    await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheetId}/entries/${entryId}/attachment`, headers: { ...bearer(token), ...ok.headers }, payload: ok.payload });
    const second = await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheetId}/entries/${entryId}/attachment`, headers: { ...bearer(token), ...ok.headers }, payload: ok.payload });
    expect(second.json().code).toBe('ATTACHMENT_EXISTS');
  });

  it('strangers cannot download', async () => {
    const ok = multipart({ name: 'file', filename: 'a.png', type: 'image/png', data: PNG });
    const up = await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheetId}/entries/${entryId}/attachment`, headers: { ...bearer(token), ...ok.headers }, payload: ok.payload });
    const other = await createUser(db); const ot = (await login(app, other.email, other.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: `/api/v1/attachments/${up.json().data.id}`, headers: bearer(ot) })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL 404.

- [ ] **Step 3: Implement**

In `src/main.ts` `configureApp`, after cookie registration:
```ts
import multipart from '@fastify/multipart';
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
```

`src/attachments/storage.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Env } from '@/common/config/env';

@Injectable()
export class StorageService {
  private readonly root: string;
  constructor(config: ConfigService<Env, true>) { this.root = path.resolve(config.get('STORAGE_PATH')); }

  async save(buffer: Buffer, ext: string): Promise<string> {
    await mkdir(this.root, { recursive: true });
    const key = `${randomUUID()}.${ext}`;
    await writeFile(path.join(this.root, key), buffer);
    return key;
  }
  stream(key: string) { return createReadStream(path.join(this.root, key)); }
  async remove(key: string): Promise<void> { await unlink(path.join(this.root, key)).catch(() => undefined); }
}
```

`src/attachments/attachments.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { attachments, sheetEntries, sheets, users } from '@/database/schema';
import { AuthUser } from '@/common/auth/auth-user';
import { DomainError, forbidden, notFound } from '@/common/errors/domain-error';
import { VisibilityService } from '@/sheets/visibility.service';
import { StorageService } from './storage.service';

const ALLOWED: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };
const MAGIC: Array<[string, Buffer]> = [['image/png', Buffer.from('89504e47', 'hex')], ['image/jpeg', Buffer.from('ffd8ff', 'hex')], ['application/pdf', Buffer.from('%PDF')]];
const EDITABLE = new Set(['draft', 'rejected']);

export interface UploadedFile { filename: string; mimetype: string; buffer: Buffer }

@Injectable()
export class AttachmentsService {
  constructor(private readonly drizzle: DrizzleService, private readonly storage: StorageService, private readonly visibility: VisibilityService) {}

  private async ownedEditableEntry(actor: AuthUser, sheetId: string, entryId: string) {
    const [r] = await this.drizzle.db.select({ entry: sheetEntries, sheet: sheets }).from(sheetEntries).innerJoin(sheets, eq(sheets.id, sheetEntries.sheetId)).where(and(eq(sheetEntries.id, entryId), eq(sheetEntries.sheetId, sheetId)));
    if (!r) throw notFound('Entry');
    if (r.sheet.employeeId !== actor.id) throw forbidden();
    if (!EDITABLE.has(r.sheet.status)) throw new DomainError('SHEET_NOT_EDITABLE', 'Sheet is locked', 409);
    return r;
  }

  async attachToEntry(actor: AuthUser, sheetId: string, entryId: string, file: UploadedFile) {
    const { entry } = await this.ownedEditableEntry(actor, sheetId, entryId);
    if (entry.attachmentId) throw new DomainError('ATTACHMENT_EXISTS', 'Entry already has an attachment', 409);
    const ext = ALLOWED[file.mimetype];
    const sniffed = MAGIC.find(([, sig]) => file.buffer.subarray(0, sig.length).equals(sig))?.[0];
    if (!ext || sniffed !== file.mimetype) throw new DomainError('ATTACHMENT_TYPE', 'Only PNG, JPEG and PDF files are allowed', 400);
    const key = await this.storage.save(file.buffer, ext);
    return this.drizzle.db.transaction(async (tx) => {
      const [a] = await tx.insert(attachments).values({ ownerId: actor.id, storageKey: key, originalName: file.filename.slice(0, 200), mimeType: file.mimetype, sizeBytes: file.buffer.length }).returning();
      await tx.update(sheetEntries).set({ attachmentId: a.id, updatedAt: new Date() }).where(eq(sheetEntries.id, entryId));
      return { id: a.id, originalName: a.originalName, mimeType: a.mimeType, sizeBytes: a.sizeBytes };
    });
  }

  async detach(actor: AuthUser, sheetId: string, entryId: string): Promise<void> {
    const { entry } = await this.ownedEditableEntry(actor, sheetId, entryId);
    if (!entry.attachmentId) throw notFound('Attachment');
    const [a] = await this.drizzle.db.select().from(attachments).where(eq(attachments.id, entry.attachmentId));
    await this.drizzle.db.transaction(async (tx) => {
      await tx.update(sheetEntries).set({ attachmentId: null }).where(eq(sheetEntries.id, entryId));
      await tx.delete(attachments).where(eq(attachments.id, entry.attachmentId!));
    });
    if (a) await this.storage.remove(a.storageKey);
  }

  async open(actor: AuthUser, attachmentId: string) {
    const [r] = await this.drizzle.db.select({ a: attachments, sheet: sheets, teamId: users.teamId }).from(attachments)
      .innerJoin(sheetEntries, eq(sheetEntries.attachmentId, attachments.id)).innerJoin(sheets, eq(sheets.id, sheetEntries.sheetId)).innerJoin(users, eq(users.id, sheets.employeeId))
      .where(eq(attachments.id, attachmentId));
    if (!r) throw notFound('Attachment');
    if (!(await this.visibility.canViewSheet(actor, { id: r.sheet.id, employeeId: r.sheet.employeeId, teamId: r.teamId }))) throw forbidden();
    return { stream: this.storage.stream(r.a.storageKey), mimeType: r.a.mimeType, originalName: r.a.originalName };
  }
}
```

`src/attachments/attachments.controller.ts`:
```ts
import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { DomainError } from '@/common/errors/domain-error';
import { AttachmentsService } from './attachments.service';

@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('sheets/:id/entries/:entryId/attachment')
  async upload(@Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string, @Req() req: FastifyRequest, @CurrentUser() actor: AuthUser) {
    const part = await req.file();
    if (!part) throw new DomainError('VALIDATION_FAILED', 'Missing file field', 400);
    const buffer = await part.toBuffer();
    if (part.file.truncated) throw new DomainError('ATTACHMENT_TOO_LARGE', 'File exceeds 5 MB', 413);
    return { data: await this.attachments.attachToEntry(actor, id, entryId, { filename: part.filename, mimetype: part.mimetype, buffer }) };
  }

  @Delete('sheets/:id/entries/:entryId/attachment') @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string, @CurrentUser() actor: AuthUser) { await this.attachments.detach(actor, id, entryId); }

  @Get('attachments/:id')
  async download(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Res() reply: FastifyReply) {
    const { stream, mimeType, originalName } = await this.attachments.open(actor, id);
    reply.header('content-type', mimeType).header('content-disposition', `inline; filename="${encodeURIComponent(originalName)}"`);
    return reply.send(stream);
  }
}
```

`src/attachments/attachments.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { SheetsModule } from '@/sheets/sheets.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { StorageService } from './storage.service';
@Module({ imports: [SheetsModule], controllers: [AttachmentsController], providers: [AttachmentsService, StorageService] })
export class AttachmentsModule {}
```

Add `AttachmentsModule` to `AppModule`. Add `storage-test` to `.gitignore`.

- [ ] **Step 4: Run tests** → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add entry attachments with local storage and sniffed MIME validation"
```

---

### Task 11: Approval chains (per-team ordered steps)

**Files:**
- Create: `src/approval-chains/approval-chains.module.ts`, `approval-chains.controller.ts`, `approval-chains.service.ts`, `approval-chains.dto.ts`
- Create: `test/approval-chains.e2e.spec.ts`
- Modify: `src/app.module.ts`, `test/helpers/factories.ts` (add `createChain`)

**Interfaces:**
- Produces: `ApprovalChainsService.getForTeam(teamId) → ChainStepView[]`, `replaceForTeam(actorId, teamId, steps)`, `snapshotInput(db, teamId) → ChainStepInput[]` (throws `CHAIN_EMPTY` or `CHAIN_APPROVER_INACTIVE`). `ChainStepView = { id, position, label, approver: {id, firstName, lastName, isActive}, backupApprover: same | null }`, `ChainStepInput = { position, label, approverId, backupApproverId: string | null }`.
- Endpoints: `GET /teams/:id/chain` (any user), `PUT /teams/:id/chain { steps: [{ label, approverId, backupApproverId? }] }` (admin; order of the array is the position).

- [ ] **Step 1: Add factory and failing test**

Append to `test/helpers/factories.ts`:
```ts
import { approvalChainSteps } from '@/database/schema';
export async function createChain(db: Db, teamId: string, approvers: Array<{ label: string; approverId: string; backupApproverId?: string | null }>) {
  return db.insert(approvalChainSteps).values(approvers.map((a, i) => ({ teamId, position: i + 1, label: a.label, approverId: a.approverId, backupApproverId: a.backupApproverId ?? null }))).returning();
}
```

`test/approval-chains.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

describe('approval chains', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let adminToken: string; let team: Awaited<ReturnType<typeof createTeam>>;
  let tl: Awaited<ReturnType<typeof createUser>>; let dm: Awaited<ReturnType<typeof createUser>>; let cto: Awaited<ReturnType<typeof createUser>>;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await truncateAll(db);
    const admin = await createUser(db, { role: 'admin' }); adminToken = (await login(app, admin.email, admin.password)).accessToken;
    team = await createTeam(db); tl = await createUser(db, { role: 'tech_lead' }); dm = await createUser(db, { role: 'delivery_manager' }); cto = await createUser(db, { role: 'cto' });
  });

  it('replaces the chain and returns it ordered with approver details', async () => {
    const put = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/chain`, headers: bearer(adminToken),
      payload: { steps: [{ label: 'Tech Lead', approverId: tl.id, backupApproverId: dm.id }, { label: 'Delivery Manager', approverId: dm.id }, { label: 'CTO', approverId: cto.id }] } });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.map((s: { position: number; label: string }) => [s.position, s.label])).toEqual([[1, 'Tech Lead'], [2, 'Delivery Manager'], [3, 'CTO']]);
    expect(put.json().data[0].backupApprover.id).toBe(dm.id);
    const again = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/chain`, headers: bearer(adminToken), payload: { steps: [{ label: 'CTO', approverId: cto.id }] } });
    expect(again.json().data).toHaveLength(1);
    const get = await app.inject({ method: 'GET', url: `/api/v1/teams/${team.id}/chain`, headers: bearer(adminToken) });
    expect(get.json().data).toHaveLength(1);
  });

  it('allows an empty chain (clears it) and rejects inactive approvers', async () => {
    const inactive = await createUser(db, { isActive: false });
    const bad = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/chain`, headers: bearer(adminToken), payload: { steps: [{ label: 'X', approverId: inactive.id }] } });
    expect(bad.json().code).toBe('CHAIN_APPROVER_INACTIVE');
    const empty = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/chain`, headers: bearer(adminToken), payload: { steps: [] } });
    expect(empty.statusCode).toBe(200); expect(empty.json().data).toEqual([]);
  });

  it('writes a chain.replaced audit entry', async () => {
    await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/chain`, headers: bearer(adminToken), payload: { steps: [{ label: 'TL', approverId: tl.id }] } });
    const audit = await app.inject({ method: 'GET', url: `/api/v1/admin/audit?entityType=chain&entityId=${team.id}`, headers: bearer(adminToken) });
    expect(audit.json().data[0].action).toBe('chain.replaced');
    expect(audit.json().data[0].after).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL 404.

- [ ] **Step 3: Implement**

`src/approval-chains/approval-chains.dto.ts`:
```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zUuid } from '@/common/zod';
export class ReplaceChainDto extends createZodDto(z.object({
  steps: z.array(z.object({ label: z.string().min(1).max(40), approverId: zUuid, backupApproverId: zUuid.nullable().optional() })).max(10),
})) {}
```

`src/approval-chains/approval-chains.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { asc, eq, inArray } from 'drizzle-orm';
import { DrizzleService, DbOrTx } from '@/database/drizzle.service';
import { approvalChainSteps, teams, users } from '@/database/schema';
import { DomainError, notFound } from '@/common/errors/domain-error';
import { AuditService } from '@/audit/audit.service';
import { ReplaceChainDto } from './approval-chains.dto';

export interface ChainStepInput { position: number; label: string; approverId: string; backupApproverId: string | null }
export interface ChainPerson { id: string; firstName: string; lastName: string; isActive: boolean }
export interface ChainStepView { id: string; position: number; label: string; approver: ChainPerson; backupApprover: ChainPerson | null }

@Injectable()
export class ApprovalChainsService {
  constructor(private readonly drizzle: DrizzleService, private readonly audit: AuditService) {}

  async getForTeam(teamId: string, db: DbOrTx = this.drizzle.db): Promise<ChainStepView[]> {
    const approver = alias(users, 'approver'); const backup = alias(users, 'backup');
    const rows = await db.select({
      id: approvalChainSteps.id, position: approvalChainSteps.position, label: approvalChainSteps.label,
      approver: { id: approver.id, firstName: approver.firstName, lastName: approver.lastName, isActive: approver.isActive },
      backup: { id: backup.id, firstName: backup.firstName, lastName: backup.lastName, isActive: backup.isActive },
    }).from(approvalChainSteps).innerJoin(approver, eq(approver.id, approvalChainSteps.approverId)).leftJoin(backup, eq(backup.id, approvalChainSteps.backupApproverId))
      .where(eq(approvalChainSteps.teamId, teamId)).orderBy(asc(approvalChainSteps.position));
    return rows.map((r) => ({ id: r.id, position: r.position, label: r.label, approver: r.approver, backupApprover: r.backup?.id ? (r.backup as ChainPerson) : null }));
  }

  async replaceForTeam(actorId: string, teamId: string, dto: ReplaceChainDto): Promise<ChainStepView[]> {
    const [team] = await this.drizzle.db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId));
    if (!team) throw notFound('Team');
    const ids = [...new Set(dto.steps.flatMap((s) => [s.approverId, s.backupApproverId].filter((x): x is string => Boolean(x))))];
    if (ids.length) {
      const found = await this.drizzle.db.select({ id: users.id, isActive: users.isActive }).from(users).where(inArray(users.id, ids));
      if (found.length !== ids.length) throw notFound('Approver');
      if (found.some((u) => !u.isActive)) throw new DomainError('CHAIN_APPROVER_INACTIVE', 'All approvers must be active users', 400);
    }
    return this.drizzle.db.transaction(async (tx) => {
      const before = await this.getForTeam(teamId, tx);
      await tx.delete(approvalChainSteps).where(eq(approvalChainSteps.teamId, teamId));
      if (dto.steps.length) {
        await tx.insert(approvalChainSteps).values(dto.steps.map((s, i) => ({ teamId, position: i + 1, label: s.label, approverId: s.approverId, backupApproverId: s.backupApproverId ?? null })));
      }
      const after = await this.getForTeam(teamId, tx);
      await this.audit.record(tx, { actorId, action: 'chain.replaced', entityType: 'chain', entityId: teamId, before, after });
      return after;
    });
  }

  /** The chain as it must be copied onto a sheet at submit time. */
  async snapshotInput(db: DbOrTx, teamId: string): Promise<ChainStepInput[]> {
    const steps = await this.getForTeam(teamId, db);
    if (steps.length === 0) throw new DomainError('CHAIN_EMPTY', 'This team has no approval chain configured', 409);
    if (steps.some((s) => !s.approver.isActive)) throw new DomainError('CHAIN_APPROVER_INACTIVE', 'An approver on this chain is inactive; ask an admin to fix the chain', 409);
    return steps.map((s) => ({ position: s.position, label: s.label, approverId: s.approver.id, backupApproverId: s.backupApprover?.isActive ? s.backupApprover.id : null }));
  }
}
```

`src/approval-chains/approval-chains.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { Roles } from '@/common/auth/roles.decorator';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { ApprovalChainsService } from './approval-chains.service';
import { ReplaceChainDto } from './approval-chains.dto';

@Controller('teams/:teamId/chain')
export class ApprovalChainsController {
  constructor(private readonly chains: ApprovalChainsService) {}
  @Get() async get(@Param('teamId', ParseUUIDPipe) teamId: string) { return { data: await this.chains.getForTeam(teamId) }; }
  @Put() @Roles('admin') async replace(@Param('teamId', ParseUUIDPipe) teamId: string, @Body() dto: ReplaceChainDto, @CurrentUser() actor: AuthUser) { return { data: await this.chains.replaceForTeam(actor.id, teamId, dto) }; }
}
```

`src/approval-chains/approval-chains.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ApprovalChainsService } from './approval-chains.service';
import { ApprovalChainsController } from './approval-chains.controller';
@Module({ controllers: [ApprovalChainsController], providers: [ApprovalChainsService], exports: [ApprovalChainsService] })
export class ApprovalChainsModule {}
```

Add to `AppModule`.

- [ ] **Step 4: Run tests** → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add per-team approval chain configuration"
```

---

### Task 12: Pure `transition()` state machine

**Files:**
- Create: `src/workflow/transition.ts`, `src/workflow/transition.spec.ts`

**Interfaces:**
- Produces (all exported from `src/workflow/transition.ts`):
```ts
export type Actor = { id: string; role: UserRole };
export interface TSheet { id: string; employeeId: string; status: SheetStatus; round: number; currentStepPosition: number | null; submittedAt: Date | null; entryCount: number }
export interface TStep { position: number; label: string; approverId: string; backupApproverId: string | null; status: ApprovalStepStatus }
export type Action =
  | { type: 'submit'; chain: ChainStepInput[] } | { type: 'withdraw' }
  | { type: 'approve'; comment?: string; overrideReason?: string } | { type: 'reject'; reason: string; overrideReason?: string }
  | { type: 'reopen'; reason: string } | { type: 'markPaid'; paymentReference: string; paidAt?: Date } | { type: 'revertPaid'; reason: string };
export interface StepUpdate { position: number; status: ApprovalStepStatus; decidedById: string | null; decidedAt: Date | null; comment: string | null; overrideReason: string | null }
export interface TransitionResult {
  patch: Partial<{ status: SheetStatus; round: number; currentStepPosition: number | null; submittedAt: Date | null; approvedAt: Date | null; rejectedAt: Date | null; rejectionReason: string | null; paidAt: Date | null; paidById: string | null; paymentReference: string | null }>;
  insertSteps: Array<TStep & { round: number; comment: string | null }>;
  updateSteps: StepUpdate[];
  deleteCurrentRoundSteps: boolean;
  auditAction: string;
  reason: string | null;
  events: Array<{ name: WorkflowEventName; payload: { sheetId: string; employeeId: string; approverIds: string[]; actorId: string; reason?: string } }>;
}
export type WorkflowEventName = 'sheet.submitted' | 'sheet.step_approved' | 'sheet.approved' | 'sheet.rejected' | 'sheet.withdrawn' | 'sheet.reopened' | 'sheet.paid' | 'sheet.payment_reverted';
export function transition(sheet: TSheet, steps: TStep[], actor: Actor, action: Action, now: Date): TransitionResult; // throws DomainError
```

- [ ] **Step 1: Write the failing unit tests**

`src/workflow/transition.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { transition, TSheet, TStep, Actor } from './transition';
import { DomainError } from '@/common/errors/domain-error';

const NOW = new Date('2026-10-05T10:00:00Z');
const emp: Actor = { id: 'emp', role: 'employee' };
const tl: Actor = { id: 'tl', role: 'tech_lead' };
const dm: Actor = { id: 'dm', role: 'delivery_manager' };
const cto: Actor = { id: 'cto', role: 'cto' };
const admin: Actor = { id: 'admin', role: 'admin' };
const fin: Actor = { id: 'fin', role: 'finance' };
const chain = [
  { position: 1, label: 'TL', approverId: 'tl', backupApproverId: 'dm' },
  { position: 2, label: 'DM', approverId: 'dm', backupApproverId: null },
  { position: 3, label: 'CTO', approverId: 'cto', backupApproverId: null },
];
const sheet = (o: Partial<TSheet> = {}): TSheet => ({ id: 's1', employeeId: 'emp', status: 'draft', round: 1, currentStepPosition: null, submittedAt: null, entryCount: 2, ...o });
const steps = (statuses: Array<TStep['status']> = ['pending', 'pending', 'pending']): TStep[] => chain.map((c, i) => ({ ...c, status: statuses[i] }));
const code = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return (e as DomainError).code; } };

describe('submit', () => {
  it('snapshots the chain, sets step 1 as current, emits submitted to step-1 approver and backup', () => {
    const r = transition(sheet(), [], emp, { type: 'submit', chain }, NOW);
    expect(r.patch).toMatchObject({ status: 'submitted', round: 1, currentStepPosition: 1, submittedAt: NOW });
    expect(r.insertSteps.map((s) => [s.position, s.status, s.round])).toEqual([[1, 'pending', 1], [2, 'pending', 1], [3, 'pending', 1]]);
    expect(r.events).toEqual([{ name: 'sheet.submitted', payload: { sheetId: 's1', employeeId: 'emp', approverIds: ['tl', 'dm'], actorId: 'emp' } }]);
    expect(r.auditAction).toBe('sheet.submitted');
  });
  it('requires owner, entries and a chain; allowed from draft or rejected', () => {
    expect(code(() => transition(sheet(), [], tl, { type: 'submit', chain }, NOW))).toBe('FORBIDDEN');
    expect(code(() => transition(sheet({ entryCount: 0 }), [], emp, { type: 'submit', chain }, NOW))).toBe('SHEET_EMPTY');
    expect(code(() => transition(sheet(), [], emp, { type: 'submit', chain: [] }, NOW))).toBe('CHAIN_EMPTY');
    expect(code(() => transition(sheet({ status: 'submitted' }), [], emp, { type: 'submit', chain }, NOW))).toBe('INVALID_TRANSITION');
    expect(code(() => transition(sheet({ status: 'rejected', submittedAt: NOW }), [], emp, { type: 'submit', chain }, NOW))).toBeNull();
  });
  it('increments the round when the sheet was submitted before', () => {
    const r = transition(sheet({ status: 'rejected', round: 1, submittedAt: NOW }), [], emp, { type: 'submit', chain }, NOW);
    expect(r.patch.round).toBe(2); expect(r.insertSteps[0].round).toBe(2);
  });
  it('skips steps whose primary approver is the owner; backup-self is ignored', () => {
    const r = transition(sheet({ employeeId: 'tl' }), [], tl, { type: 'submit', chain }, NOW);
    expect(r.insertSteps.map((s) => s.status)).toEqual(['skipped', 'pending', 'pending']);
    expect(r.insertSteps[0].comment).toBe('self');
    expect(r.patch.currentStepPosition).toBe(2);
    expect(r.events[0].payload.approverIds).toEqual(['dm']);
    const r2 = transition(sheet({ employeeId: 'dm' }), [], dm, { type: 'submit', chain }, NOW);
    expect(r2.insertSteps.map((s) => s.status)).toEqual(['pending', 'skipped', 'pending']);
    expect(r2.patch.currentStepPosition).toBe(1);
  });
  it('auto-approves when every step is skipped', () => {
    const r = transition(sheet({ employeeId: 'cto' }), [], cto, { type: 'submit', chain: [{ position: 1, label: 'CTO', approverId: 'cto', backupApproverId: null }] }, NOW);
    expect(r.patch).toMatchObject({ status: 'approved', approvedAt: NOW, currentStepPosition: null });
    expect(r.events.map((e) => e.name)).toEqual(['sheet.submitted', 'sheet.approved']);
  });
});

describe('approve', () => {
  const sub = sheet({ status: 'submitted', currentStepPosition: 1, submittedAt: NOW });
  it('advances to the next pending step and notifies its approver', () => {
    const r = transition(sub, steps(), tl, { type: 'approve', comment: 'ok' }, NOW);
    expect(r.patch).toEqual({ currentStepPosition: 2 });
    expect(r.updateSteps).toEqual([{ position: 1, status: 'approved', decidedById: 'tl', decidedAt: NOW, comment: 'ok', overrideReason: null }]);
    expect(r.events).toEqual([{ name: 'sheet.step_approved', payload: { sheetId: 's1', employeeId: 'emp', approverIds: ['dm'], actorId: 'tl' } }]);
  });
  it('backup approver may approve', () => { expect(code(() => transition(sub, steps(), dm, { type: 'approve' }, NOW))).toBeNull(); });
  it('wrong approver is NOT_CURRENT_APPROVER; non-submitted is INVALID_TRANSITION', () => {
    expect(code(() => transition(sub, steps(), cto, { type: 'approve' }, NOW))).toBe('NOT_CURRENT_APPROVER');
    expect(code(() => transition(sub, steps(), emp, { type: 'approve' }, NOW))).toBe('NOT_CURRENT_APPROVER');
    expect(code(() => transition(sheet(), steps(), tl, { type: 'approve' }, NOW))).toBe('INVALID_TRANSITION');
  });
  it('admin may override only with a reason', () => {
    expect(code(() => transition(sub, steps(), admin, { type: 'approve' }, NOW))).toBe('REASON_REQUIRED');
    const r = transition(sub, steps(), admin, { type: 'approve', overrideReason: 'TL on leave' }, NOW);
    expect(r.updateSteps[0]).toMatchObject({ decidedById: 'admin', overrideReason: 'TL on leave' });
  });
  it('last step approval completes the sheet', () => {
    const last = sheet({ status: 'submitted', currentStepPosition: 3, submittedAt: NOW });
    const r = transition(last, steps(['approved', 'approved', 'pending']), cto, { type: 'approve' }, NOW);
    expect(r.patch).toMatchObject({ status: 'approved', approvedAt: NOW, currentStepPosition: null });
    expect(r.events).toEqual([{ name: 'sheet.approved', payload: { sheetId: 's1', employeeId: 'emp', approverIds: [], actorId: 'cto' } }]);
    expect(r.auditAction).toBe('sheet.approved');
  });
  it('skips over skipped steps when advancing', () => {
    const r = transition(sub, steps(['pending', 'skipped', 'pending']), tl, { type: 'approve' }, NOW);
    expect(r.patch.currentStepPosition).toBe(3);
  });
});

describe('reject', () => {
  const sub = sheet({ status: 'submitted', currentStepPosition: 2, submittedAt: NOW });
  it('marks current rejected, remaining skipped, sheet rejected with reason', () => {
    const r = transition(sub, steps(['approved', 'pending', 'pending']), dm, { type: 'reject', reason: 'Missing ticket refs' }, NOW);
    expect(r.patch).toMatchObject({ status: 'rejected', rejectedAt: NOW, rejectionReason: 'Missing ticket refs', currentStepPosition: null });
    expect(r.updateSteps).toEqual([
      { position: 2, status: 'rejected', decidedById: 'dm', decidedAt: NOW, comment: 'Missing ticket refs', overrideReason: null },
      { position: 3, status: 'skipped', decidedById: null, decidedAt: NOW, comment: 'round rejected', overrideReason: null },
    ]);
    expect(r.events[0]).toEqual({ name: 'sheet.rejected', payload: { sheetId: 's1', employeeId: 'emp', approverIds: [], actorId: 'dm', reason: 'Missing ticket refs' } });
  });
  it('requires a reason of 5+ chars', () => { expect(code(() => transition(sub, steps(['approved', 'pending', 'pending']), dm, { type: 'reject', reason: 'no' }, NOW))).toBe('REASON_REQUIRED'); });
});

describe('withdraw', () => {
  it('owner withdraws before any approval; steps of the round are deleted', () => {
    const r = transition(sheet({ status: 'submitted', currentStepPosition: 1, submittedAt: NOW }), steps(), emp, { type: 'withdraw' }, NOW);
    expect(r.patch).toEqual({ status: 'draft', currentStepPosition: null });
    expect(r.deleteCurrentRoundSteps).toBe(true);
    expect(r.events[0]).toMatchObject({ name: 'sheet.withdrawn', payload: { approverIds: ['tl', 'dm', 'cto'] } });
  });
  it('fails after a step was approved, or for non-owner', () => {
    const s = sheet({ status: 'submitted', currentStepPosition: 2, submittedAt: NOW });
    expect(code(() => transition(s, steps(['approved', 'pending', 'pending']), emp, { type: 'withdraw' }, NOW))).toBe('INVALID_TRANSITION');
    expect(code(() => transition(sheet({ status: 'submitted', currentStepPosition: 1, submittedAt: NOW }), steps(), tl, { type: 'withdraw' }, NOW))).toBe('FORBIDDEN');
  });
});

describe('reopen / markPaid / revertPaid', () => {
  const approved = sheet({ status: 'approved', submittedAt: NOW });
  it('admin reopens approved → draft with reason', () => {
    expect(code(() => transition(approved, [], fin, { type: 'reopen', reason: 'Wrong month' }, NOW))).toBe('FORBIDDEN');
    expect(code(() => transition(approved, [], admin, { type: 'reopen', reason: '' }, NOW))).toBe('REASON_REQUIRED');
    const r = transition(approved, [], admin, { type: 'reopen', reason: 'Wrong month' }, NOW);
    expect(r.patch).toEqual({ status: 'draft', approvedAt: null, currentStepPosition: null });
    expect(r.reason).toBe('Wrong month');
  });
  it('finance marks paid with a reference; employee cannot; needs approved', () => {
    expect(code(() => transition(approved, [], emp, { type: 'markPaid', paymentReference: 'PAY-1' }, NOW))).toBe('FORBIDDEN');
    expect(code(() => transition(approved, [], fin, { type: 'markPaid', paymentReference: ' ' }, NOW))).toBe('PAYMENT_REFERENCE_REQUIRED');
    expect(code(() => transition(sheet({ status: 'submitted' }), [], fin, { type: 'markPaid', paymentReference: 'PAY-1' }, NOW))).toBe('INVALID_TRANSITION');
    const r = transition(approved, [], fin, { type: 'markPaid', paymentReference: 'PAY-1' }, NOW);
    expect(r.patch).toEqual({ status: 'paid', paidAt: NOW, paidById: 'fin', paymentReference: 'PAY-1' });
    expect(r.events[0].name).toBe('sheet.paid');
  });
  it('revertPaid returns to approved and clears payment fields', () => {
    const r = transition(sheet({ status: 'paid' }), [], admin, { type: 'revertPaid', reason: 'Duplicate batch' }, NOW);
    expect(r.patch).toEqual({ status: 'approved', paidAt: null, paidById: null, paymentReference: null });
    expect(r.events[0].name).toBe('sheet.payment_reverted');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm vitest run src/workflow` → FAIL (module missing).

- [ ] **Step 3: Implement**

`src/workflow/transition.ts`:
```ts
import { ApprovalStepStatus, SheetStatus, UserRole } from '@/database/schema';
import { DomainError, forbidden } from '@/common/errors/domain-error';
import { ChainStepInput } from '@/approval-chains/approval-chains.service';

export type Actor = { id: string; role: UserRole };
export interface TSheet { id: string; employeeId: string; status: SheetStatus; round: number; currentStepPosition: number | null; submittedAt: Date | null; entryCount: number }
export interface TStep { position: number; label: string; approverId: string; backupApproverId: string | null; status: ApprovalStepStatus }
export type Action =
  | { type: 'submit'; chain: ChainStepInput[] } | { type: 'withdraw' }
  | { type: 'approve'; comment?: string; overrideReason?: string } | { type: 'reject'; reason: string; overrideReason?: string }
  | { type: 'reopen'; reason: string } | { type: 'markPaid'; paymentReference: string; paidAt?: Date } | { type: 'revertPaid'; reason: string };
export interface StepUpdate { position: number; status: ApprovalStepStatus; decidedById: string | null; decidedAt: Date | null; comment: string | null; overrideReason: string | null }
export type WorkflowEventName = 'sheet.submitted' | 'sheet.step_approved' | 'sheet.approved' | 'sheet.rejected' | 'sheet.withdrawn' | 'sheet.reopened' | 'sheet.paid' | 'sheet.payment_reverted';
export interface WorkflowEvent { name: WorkflowEventName; payload: { sheetId: string; employeeId: string; approverIds: string[]; actorId: string; reason?: string } }
export interface TransitionResult {
  patch: Partial<{ status: SheetStatus; round: number; currentStepPosition: number | null; submittedAt: Date | null; approvedAt: Date | null; rejectedAt: Date | null; rejectionReason: string | null; paidAt: Date | null; paidById: string | null; paymentReference: string | null }>;
  insertSteps: Array<TStep & { round: number; comment: string | null }>;
  updateSteps: StepUpdate[];
  deleteCurrentRoundSteps: boolean;
  auditAction: string;
  reason: string | null;
  events: WorkflowEvent[];
}

const invalid = (msg: string) => new DomainError('INVALID_TRANSITION', msg, 409);
const needReason = (what: string) => new DomainError('REASON_REQUIRED', `${what} requires a reason`, 400);
const base = (): TransitionResult => ({ patch: {}, insertSteps: [], updateSteps: [], deleteCurrentRoundSteps: false, auditAction: '', reason: null, events: [] });
const ev = (name: WorkflowEventName, sheet: TSheet, actor: Actor, approverIds: string[], reason?: string): WorkflowEvent => ({ name, payload: { sheetId: sheet.id, employeeId: sheet.employeeId, approverIds, actorId: actor.id, ...(reason ? { reason } : {}) } });
const approversOf = (s: TStep) => [s.approverId, ...(s.backupApproverId ? [s.backupApproverId] : [])];
const isFinance = (a: Actor) => a.role === 'finance' || a.role === 'admin';

export function transition(sheet: TSheet, steps: TStep[], actor: Actor, action: Action, now: Date): TransitionResult {
  switch (action.type) {
    case 'submit': return submit(sheet, actor, action.chain, now);
    case 'withdraw': return withdraw(sheet, steps, actor);
    case 'approve': return decide(sheet, steps, actor, { kind: 'approve', comment: action.comment ?? null, overrideReason: action.overrideReason ?? null }, now);
    case 'reject': return decide(sheet, steps, actor, { kind: 'reject', comment: action.reason, overrideReason: action.overrideReason ?? null }, now);
    case 'reopen': return reopen(sheet, actor, action.reason);
    case 'markPaid': return markPaid(sheet, actor, action.paymentReference, action.paidAt ?? now);
    case 'revertPaid': return revertPaid(sheet, actor, action.reason);
  }
}

function submit(sheet: TSheet, actor: Actor, chain: ChainStepInput[], now: Date): TransitionResult {
  if (actor.id !== sheet.employeeId) throw forbidden('Only the sheet owner can submit');
  if (sheet.status !== 'draft' && sheet.status !== 'rejected') throw invalid(`Cannot submit a ${sheet.status} sheet`);
  if (sheet.entryCount === 0) throw new DomainError('SHEET_EMPTY', 'Add at least one entry before submitting', 409);
  if (chain.length === 0) throw new DomainError('CHAIN_EMPTY', 'This team has no approval chain configured', 409);
  const r = base();
  const round = sheet.submittedAt ? sheet.round + 1 : sheet.round;
  r.insertSteps = chain.map((c) => {
    const self = c.approverId === sheet.employeeId;
    return { position: c.position, label: c.label, approverId: c.approverId, backupApproverId: c.backupApproverId, status: self ? 'skipped' : 'pending', round, comment: self ? 'self' : null };
  });
  const first = r.insertSteps.find((s) => s.status === 'pending');
  r.patch = { status: 'submitted', round, currentStepPosition: first?.position ?? null, submittedAt: now, rejectedAt: null, rejectionReason: null };
  r.auditAction = 'sheet.submitted';
  r.events.push(ev('sheet.submitted', sheet, actor, first ? approversOf(first) : []));
  if (!first) {
    r.patch = { ...r.patch, status: 'approved', approvedAt: now, currentStepPosition: null };
    r.auditAction = 'sheet.approved';
    r.events.push(ev('sheet.approved', sheet, actor, []));
  }
  return r;
}

function withdraw(sheet: TSheet, steps: TStep[], actor: Actor): TransitionResult {
  if (actor.id !== sheet.employeeId) throw forbidden('Only the sheet owner can withdraw');
  if (sheet.status !== 'submitted') throw invalid(`Cannot withdraw a ${sheet.status} sheet`);
  if (steps.some((s) => s.status === 'approved')) throw invalid('Cannot withdraw after a step has been approved');
  const r = base();
  r.patch = { status: 'draft', currentStepPosition: null };
  r.deleteCurrentRoundSteps = true;
  r.auditAction = 'sheet.withdrawn';
  r.events.push(ev('sheet.withdrawn', sheet, actor, [...new Set(steps.flatMap(approversOf))]));
  return r;
}

function decide(sheet: TSheet, steps: TStep[], actor: Actor, d: { kind: 'approve' | 'reject'; comment: string | null; overrideReason: string | null }, now: Date): TransitionResult {
  if (sheet.status !== 'submitted') throw invalid(`Cannot ${d.kind} a ${sheet.status} sheet`);
  const current = steps.find((s) => s.position === sheet.currentStepPosition && s.status === 'pending');
  if (!current) throw invalid('Sheet has no pending step');
  const isAdmin = actor.role === 'admin';
  const named = approversOf(current).includes(actor.id);
  if (!named && !isAdmin) throw new DomainError('NOT_CURRENT_APPROVER', 'You are not the approver for the current step', 403);
  if (!named && isAdmin && !d.overrideReason?.trim()) throw needReason('Admin override');
  if (d.kind === 'reject' && (d.comment ?? '').trim().length < 5) throw needReason('Rejection');
  const override = named ? null : d.overrideReason;
  const r = base();
  r.updateSteps.push({ position: current.position, status: d.kind === 'approve' ? 'approved' : 'rejected', decidedById: actor.id, decidedAt: now, comment: d.comment, overrideReason: override });
  if (d.kind === 'reject') {
    for (const s of steps) if (s.status === 'pending' && s.position > current.position) r.updateSteps.push({ position: s.position, status: 'skipped', decidedById: null, decidedAt: now, comment: 'round rejected', overrideReason: null });
    r.patch = { status: 'rejected', rejectedAt: now, rejectionReason: d.comment, currentStepPosition: null };
    r.auditAction = 'sheet.rejected'; r.reason = d.comment;
    r.events.push(ev('sheet.rejected', sheet, actor, [], d.comment!));
    return r;
  }
  const next = steps.filter((s) => s.status === 'pending' && s.position > current.position).sort((a, b) => a.position - b.position)[0];
  if (next) {
    r.patch = { currentStepPosition: next.position };
    r.auditAction = 'sheet.step_approved';
    r.events.push(ev('sheet.step_approved', sheet, actor, approversOf(next)));
  } else {
    r.patch = { status: 'approved', approvedAt: now, currentStepPosition: null };
    r.auditAction = 'sheet.approved';
    r.events.push(ev('sheet.approved', sheet, actor, []));
  }
  r.reason = override;
  return r;
}

function reopen(sheet: TSheet, actor: Actor, reason: string): TransitionResult {
  if (actor.role !== 'admin') throw forbidden('Only admins can reopen sheets');
  if (sheet.status !== 'approved') throw invalid(`Cannot reopen a ${sheet.status} sheet`);
  if (!reason?.trim()) throw needReason('Reopen');
  const r = base();
  r.patch = { status: 'draft', approvedAt: null, currentStepPosition: null };
  r.auditAction = 'sheet.reopened'; r.reason = reason;
  r.events.push(ev('sheet.reopened', sheet, actor, [], reason));
  return r;
}

function markPaid(sheet: TSheet, actor: Actor, paymentReference: string, paidAt: Date): TransitionResult {
  if (!isFinance(actor)) throw forbidden('Only finance or admin can mark sheets paid');
  if (sheet.status !== 'approved') throw invalid(`Cannot mark a ${sheet.status} sheet as paid`);
  if (!paymentReference?.trim()) throw new DomainError('PAYMENT_REFERENCE_REQUIRED', 'Payment reference is required', 400);
  const r = base();
  r.patch = { status: 'paid', paidAt, paidById: actor.id, paymentReference: paymentReference.trim() };
  r.auditAction = 'sheet.paid';
  r.events.push(ev('sheet.paid', sheet, actor, []));
  return r;
}

function revertPaid(sheet: TSheet, actor: Actor, reason: string): TransitionResult {
  if (!isFinance(actor)) throw forbidden('Only finance or admin can revert payments');
  if (sheet.status !== 'paid') throw invalid(`Cannot revert payment on a ${sheet.status} sheet`);
  if (!reason?.trim()) throw needReason('Revert payment');
  const r = base();
  r.patch = { status: 'approved', paidAt: null, paidById: null, paymentReference: null };
  r.auditAction = 'sheet.payment_reverted'; r.reason = reason;
  r.events.push(ev('sheet.payment_reverted', sheet, actor, [], reason));
  return r;
}
```
Note on the submit test expecting `patch` to `toMatchObject({ status, round, currentStepPosition, submittedAt })`: the patch also clears `rejectedAt`/`rejectionReason`, which `toMatchObject` tolerates.

- [ ] **Step 4: Run tests** — `pnpm vitest run src/workflow` → PASS (22).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add pure sheet workflow transition function with exhaustive tests"
```

---

### Task 13: WorkflowService, action endpoints, timeline, bulk mark-paid

**Files:**
- Create: `src/workflow/workflow.module.ts`, `workflow.service.ts`, `workflow.controller.ts`, `workflow.dto.ts`
- Create: `test/workflow.e2e.spec.ts`
- Modify: `src/app.module.ts` (WorkflowModule, `EventEmitterModule.forRoot()`), `test/helpers/factories.ts` (add `submittedSheet` helper)

**Interfaces:**
- Produces: `WorkflowService.act(actor: AuthUser, sheetId: string, action: Action, expectedVersion: number) → SheetSummary` (throws `SHEET_VERSION_CONFLICT` 409 on mismatch); `WorkflowService.markPaidBulk(actor, items: {id, version}[], paymentReference) → { paid: string[], failed: { id, code }[] }`; `WorkflowService.timeline(actor, sheetId) → { audit: AuditRow[], rounds: Array<{ round: number; steps: StepView[] }> }`. Events are emitted on `EventEmitter2` after commit with `WorkflowEvent.payload`.
- Endpoints: `POST /sheets/:id/submit|withdraw|approve|reject|reopen|mark-paid|revert-paid` with body `{ version, comment?, reason?, overrideReason?, paymentReference?, paidAt? }` → `{ data: SheetSummary }`; `POST /sheets/mark-paid { sheets: [{ id, version }], paymentReference }`; `GET /sheets/:id/timeline`.

- [ ] **Step 1: Install and add helpers**

```bash
pnpm add @nestjs/event-emitter@^3
```

Append to `test/helpers/factories.ts`:
```ts
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { bearer } from './app';

/** Builds team + chain (TL → DM → CTO), an employee with entries, and submits the sheet. */
export async function submittedSheet(app: NestFastifyApplication, db: Db, loginFn: (email: string, password: string) => Promise<{ accessToken: string }>) {
  const tl = await createUser(db, { role: 'tech_lead' }); const dm = await createUser(db, { role: 'delivery_manager' }); const cto = await createUser(db, { role: 'cto' });
  const team = await createTeam(db, { techLeadId: tl.id });
  await createChain(db, team.id, [{ label: 'Tech Lead', approverId: tl.id, backupApproverId: dm.id }, { label: 'Delivery Manager', approverId: dm.id }, { label: 'CTO', approverId: cto.id }]);
  const emp = await createUser(db, { teamId: team.id });
  const type = await createOvertimeType(db, { multiplier: '1.50' });
  const sheet = await createSheet(db, emp.id, '2026-09');
  await createEntry(db, sheet.id, type.id, { date: '2026-09-10' });
  await createEntry(db, sheet.id, type.id, { date: '2026-09-11' });
  const empToken = (await loginFn(emp.email, emp.password)).accessToken;
  const res = await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheet.id}/submit`, headers: bearer(empToken), payload: { version: 1 } });
  if (res.statusCode !== 200) throw new Error(`submit failed: ${res.body}`);
  return { tl, dm, cto, team, emp, type, sheetId: sheet.id as string, empToken, version: res.json().data.version as number };
}
```

- [ ] **Step 2: Write the failing e2e test**

`test/workflow.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam, createChain, createOvertimeType, createSheet, createEntry, submittedSheet } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { overtimeTypes, sheetEntries } from '@/database/schema';

describe('workflow', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); });
  const act = (token: string, id: string, action: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/api/v1/sheets/${id}/${action}`, headers: bearer(token), payload });
  const tok = (u: { email: string; password: string }) => login(app, u.email, u.password).then((r) => r.accessToken);
  const loginFn = (e: string, p: string) => login(app, e, p);

  it('runs the happy path: submit → TL → DM → CTO → paid, with version bumps and timeline', async () => {
    const s = await submittedSheet(app, db, loginFn);
    expect(s.version).toBe(2);
    const r1 = await act(await tok(s.tl), s.sheetId, 'approve', { version: 2, comment: 'fine' });
    expect(r1.statusCode).toBe(200); expect(r1.json().data).toMatchObject({ status: 'submitted', currentStepPosition: 2, version: 3 });
    const r2 = await act(await tok(s.dm), s.sheetId, 'approve', { version: 3 });
    expect(r2.json().data.currentStepPosition).toBe(3);
    const r3 = await act(await tok(s.cto), s.sheetId, 'approve', { version: 4 });
    expect(r3.json().data).toMatchObject({ status: 'approved', currentStepPosition: null });
    const fin = await createUser(db, { role: 'finance' });
    const paid = await act(await tok(fin), s.sheetId, 'mark-paid', { version: 5, paymentReference: 'PAY-2026-09' });
    expect(paid.json().data).toMatchObject({ status: 'paid', paymentReference: 'PAY-2026-09' });
    const tl = await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.sheetId}/timeline`, headers: bearer(s.empToken) });
    expect(tl.json().data.audit.map((a: { action: string }) => a.action)).toEqual(['sheet.submitted', 'sheet.step_approved', 'sheet.step_approved', 'sheet.approved', 'sheet.paid']);
    expect(tl.json().data.rounds[0].steps.map((x: { status: string }) => x.status)).toEqual(['approved', 'approved', 'approved']);
  });

  it('rejects a stale version with 409 SHEET_VERSION_CONFLICT (two approvers racing)', async () => {
    const s = await submittedSheet(app, db, loginFn);
    const first = await act(await tok(s.tl), s.sheetId, 'approve', { version: 2 });
    expect(first.statusCode).toBe(200);
    const second = await act(await tok(s.dm), s.sheetId, 'approve', { version: 2 }); // dm is backup of step 1, uses stale version
    expect(second.statusCode).toBe(409); expect(second.json().code).toBe('SHEET_VERSION_CONFLICT');
    const detail = await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.sheetId}`, headers: bearer(s.empToken) });
    expect(detail.json().data.currentStepPosition).toBe(2);
  });

  it('keeps the snapshot when the team chain is edited mid-flight', async () => {
    const s = await submittedSheet(app, db, loginFn);
    const admin = await createUser(db, { role: 'admin' }); const at = await tok(admin);
    const newcomer = await createUser(db, { role: 'cto' });
    await app.inject({ method: 'PUT', url: `/api/v1/teams/${s.team.id}/chain`, headers: bearer(at), payload: { steps: [{ label: 'Only', approverId: newcomer.id }] } });
    const r = await act(await tok(newcomer), s.sheetId, 'approve', { version: 2 });
    expect(r.json().code).toBe('NOT_CURRENT_APPROVER');
    const ok = await act(await tok(s.tl), s.sheetId, 'approve', { version: 2 });
    expect(ok.json().data.currentStepPosition).toBe(2);
  });

  it('reject → employee edits → resubmit starts round 2; withdraw only before first approval', async () => {
    const s = await submittedSheet(app, db, loginFn);
    const rej = await act(await tok(s.tl), s.sheetId, 'reject', { version: 2, reason: 'Add ticket links' });
    expect(rej.json().data).toMatchObject({ status: 'rejected', rejectionReason: 'Add ticket links' });
    const edit = await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.sheetId}/entries`, headers: bearer(s.empToken),
      payload: { date: '2026-09-12', startTime: '18:00', endTime: '19:00', overtimeTypeId: s.type.id, workItem: 'PROJ-3', description: 'Follow-up fixes done' } });
    expect(edit.statusCode).toBe(201);
    const re = await act(s.empToken, s.sheetId, 'submit', { version: 3 });
    expect(re.json().data).toMatchObject({ status: 'submitted', round: 2, currentStepPosition: 1 });
    const wd = await act(s.empToken, s.sheetId, 'withdraw', { version: 4 });
    expect(wd.json().data.status).toBe('draft');
    const tl = await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.sheetId}/timeline`, headers: bearer(s.empToken) });
    expect(tl.json().data.rounds.map((r: { round: number }) => r.round)).toEqual([1]); // round 2 steps deleted on withdraw
  });

  it('admin override needs a reason and is recorded; reopen; revert paid', async () => {
    const s = await submittedSheet(app, db, loginFn);
    const admin = await createUser(db, { role: 'admin' }); const at = await tok(admin);
    expect((await act(at, s.sheetId, 'approve', { version: 2 })).json().code).toBe('REASON_REQUIRED');
    for (const v of [2, 3, 4]) expect((await act(at, s.sheetId, 'approve', { version: v, overrideReason: 'Approvers on leave' })).statusCode).toBe(200);
    const detail = await app.inject({ method: 'GET', url: `/api/v1/sheets/${s.sheetId}`, headers: bearer(at) });
    expect(detail.json().data.status).toBe('approved');
    expect(detail.json().data.steps.every((x: { overrideReason: string | null; decidedBy: { id: string } }) => x.overrideReason === 'Approvers on leave' && x.decidedBy.id === admin.id)).toBe(true);
    const paid = await act(at, s.sheetId, 'mark-paid', { version: 5, paymentReference: 'X' });
    expect(paid.json().data.status).toBe('paid');
    expect((await act(at, s.sheetId, 'reopen', { version: 6, reason: 'nope' })).json().code).toBe('INVALID_TRANSITION');
    const rev = await act(at, s.sheetId, 'revert-paid', { version: 6, reason: 'Wrong batch' });
    expect(rev.json().data.status).toBe('approved');
    const re = await act(at, s.sheetId, 'reopen', { version: 7, reason: 'Fix hours' });
    expect(re.json().data.status).toBe('draft');
  });

  it('submit fails without team or chain, re-snapshots multipliers, and bulk mark-paid reports per-sheet results', async () => {
    const noTeam = await createUser(db); const type = await createOvertimeType(db, { multiplier: '1.50' });
    const sh = await createSheet(db, noTeam.id); await createEntry(db, sh.id, type.id);
    expect((await act(await tok(noTeam), sh.id, 'submit', { version: 1 })).json().code).toBe('USER_HAS_NO_TEAM');
    const team = await createTeam(db); const inTeam = await createUser(db, { teamId: team.id });
    const sh2 = await createSheet(db, inTeam.id); await createEntry(db, sh2.id, type.id, { multiplier: '1.50' });
    expect((await act(await tok(inTeam), sh2.id, 'submit', { version: 1 })).json().code).toBe('CHAIN_EMPTY');
    const cto = await createUser(db, { role: 'cto' }); await createChain(db, team.id, [{ label: 'CTO', approverId: cto.id }]);
    await db.update(overtimeTypes).set({ multiplier: '2.00' }).where(eq(overtimeTypes.id, type.id));
    const sub = await act(await tok(inTeam), sh2.id, 'submit', { version: 1 });
    expect(sub.statusCode).toBe(200);
    const [entry] = await db.select().from(sheetEntries).where(eq(sheetEntries.sheetId, sh2.id));
    expect(entry.multiplierSnapshot).toBe('2.00'); expect(sub.json().data.totalWeightedHours).toBe(4);
    await act(await tok(cto), sh2.id, 'approve', { version: 2 });
    const fin = await createUser(db, { role: 'finance' });
    const bulk = await app.inject({ method: 'POST', url: '/api/v1/sheets/mark-paid', headers: bearer(await tok(fin)), payload: { sheets: [{ id: sh2.id, version: 3 }, { id: sh.id, version: 1 }], paymentReference: 'BATCH-1' } });
    expect(bulk.json().data).toEqual({ paid: [sh2.id], failed: [{ id: sh.id, code: 'INVALID_TRANSITION' }] });
  });
});
```

- [ ] **Step 3: Run to verify it fails** → FAIL 404.

- [ ] **Step 4: Implement**

`src/workflow/workflow.dto.ts`:
```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zUuid } from '@/common/zod';
const version = z.number().int().positive();
export class SubmitDto extends createZodDto(z.object({ version })) {}
export class WithdrawDto extends createZodDto(z.object({ version })) {}
export class ApproveDto extends createZodDto(z.object({ version, comment: z.string().max(500).optional(), overrideReason: z.string().max(500).optional() })) {}
export class RejectDto extends createZodDto(z.object({ version, reason: z.string().max(500), overrideReason: z.string().max(500).optional() })) {}
export class ReasonDto extends createZodDto(z.object({ version, reason: z.string().max(500) })) {}
export class MarkPaidDto extends createZodDto(z.object({ version, paymentReference: z.string().max(60), paidAt: z.string().datetime().optional() })) {}
export class MarkPaidBulkDto extends createZodDto(z.object({ sheets: z.array(z.object({ id: zUuid, version })).min(1).max(200), paymentReference: z.string().min(1).max(60), paidAt: z.string().datetime().optional() })) {}
```

`src/workflow/workflow.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, asc, count, eq } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { overtimeTypes, sheetApprovalSteps, sheetEntries, sheets, users } from '@/database/schema';
import { AuthUser } from '@/common/auth/auth-user';
import { DomainError } from '@/common/errors/domain-error';
import { AuditService } from '@/audit/audit.service';
import { ApprovalChainsService } from '@/approval-chains/approval-chains.service';
import { SheetsService, SheetSummary } from '@/sheets/sheets.service';
import { weighted } from '@/sheets/hours';
import { Action, transition, TransitionResult, TStep } from './transition';

@Injectable()
export class WorkflowService {
  constructor(private readonly drizzle: DrizzleService, private readonly sheetsSvc: SheetsService, private readonly chains: ApprovalChainsService, private readonly audit: AuditService, private readonly events: EventEmitter2) {}

  async act(actor: AuthUser, sheetId: string, action: Action, expectedVersion: number): Promise<SheetSummary> {
    const now = new Date();
    const { summary, result } = await this.drizzle.db.transaction(async (tx) => {
      const row = await this.sheetsSvc.lockForUpdate(tx, sheetId);
      if (row.version !== expectedVersion) throw new DomainError('SHEET_VERSION_CONFLICT', 'Sheet was modified by someone else; reload and try again', 409);
      const [{ entryCount }] = await tx.select({ entryCount: count() }).from(sheetEntries).where(eq(sheetEntries.sheetId, sheetId));
      const stepRows = await tx.select().from(sheetApprovalSteps).where(and(eq(sheetApprovalSteps.sheetId, sheetId), eq(sheetApprovalSteps.round, row.round))).orderBy(asc(sheetApprovalSteps.position));
      const steps: TStep[] = stepRows.map((s) => ({ position: s.position, label: s.label, approverId: s.approverId, backupApproverId: s.backupApproverId, status: s.status }));

      let effective = action;
      if (action.type === 'submit') {
        const [emp] = await tx.select({ teamId: users.teamId }).from(users).where(eq(users.id, row.employeeId));
        if (!emp?.teamId) throw new DomainError('USER_HAS_NO_TEAM', 'You must belong to a team before submitting', 409);
        effective = { type: 'submit', chain: await this.chains.snapshotInput(tx, emp.teamId) };
      }

      const result = transition(
        { id: row.id, employeeId: row.employeeId, status: row.status, round: row.round, currentStepPosition: row.currentStepPosition, submittedAt: row.submittedAt, entryCount: Number(entryCount) },
        steps, { id: actor.id, role: actor.role }, effective, now,
      );

      if (action.type === 'submit') {
        await this.resnapshotMultipliers(tx, sheetId);
        await this.sheetsSvc.recomputeTotals(tx, sheetId);
      }
      if (result.deleteCurrentRoundSteps) await tx.delete(sheetApprovalSteps).where(and(eq(sheetApprovalSteps.sheetId, sheetId), eq(sheetApprovalSteps.round, row.round)));
      if (result.insertSteps.length) await tx.insert(sheetApprovalSteps).values(result.insertSteps.map((s) => ({ sheetId, round: s.round, position: s.position, label: s.label, approverId: s.approverId, backupApproverId: s.backupApproverId, status: s.status, comment: s.comment, decidedAt: s.status === 'skipped' ? now : null })));
      for (const u of result.updateSteps) {
        await tx.update(sheetApprovalSteps).set({ status: u.status, decidedById: u.decidedById, decidedAt: u.decidedAt, comment: u.comment, overrideReason: u.overrideReason })
          .where(and(eq(sheetApprovalSteps.sheetId, sheetId), eq(sheetApprovalSteps.round, result.patch.round ?? row.round), eq(sheetApprovalSteps.position, u.position)));
      }
      const [updated] = await tx.update(sheets).set({ ...result.patch, version: row.version + 1, updatedAt: now }).where(eq(sheets.id, sheetId)).returning();
      await this.audit.record(tx, { actorId: actor.id, action: result.auditAction, entityType: 'sheet', entityId: sheetId, reason: result.reason,
        before: { status: row.status, round: row.round, currentStepPosition: row.currentStepPosition }, after: { status: updated.status, round: updated.round, currentStepPosition: updated.currentStepPosition } });
      const raw = await this.sheetsSvc.findRaw(sheetId, tx);
      return { summary: SheetsService.toSummary(raw), result };
    });
    this.emit(result);
    return summary;
  }

  private emit(result: TransitionResult) {
    for (const e of result.events) this.events.emit(e.name, e.payload);
  }

  private async resnapshotMultipliers(tx: Parameters<Parameters<DrizzleService['db']['transaction']>[0]>[0], sheetId: string) {
    const rows = await tx.select({ id: sheetEntries.id, hours: sheetEntries.hours, multiplier: overtimeTypes.multiplier }).from(sheetEntries).innerJoin(overtimeTypes, eq(overtimeTypes.id, sheetEntries.overtimeTypeId)).where(eq(sheetEntries.sheetId, sheetId));
    for (const r of rows) {
      await tx.update(sheetEntries).set({ multiplierSnapshot: r.multiplier, weightedHours: weighted(Number(r.hours), Number(r.multiplier)).toFixed(2) }).where(eq(sheetEntries.id, r.id));
    }
  }

  async markPaidBulk(actor: AuthUser, items: Array<{ id: string; version: number }>, paymentReference: string, paidAt?: Date) {
    const paid: string[] = []; const failed: Array<{ id: string; code: string }> = [];
    for (const item of items) {
      try { await this.act(actor, item.id, { type: 'markPaid', paymentReference, paidAt }, item.version); paid.push(item.id); }
      catch (err) { failed.push({ id: item.id, code: err instanceof DomainError ? err.code : 'INTERNAL' }); }
    }
    return { paid, failed };
  }

  async timeline(actor: AuthUser, sheetId: string) {
    const r = await this.sheetsSvc.assertCanView(actor, sheetId);
    const audit = await this.audit.timelineForSheet(sheetId);
    const roundNums = await this.drizzle.db.selectDistinct({ round: sheetApprovalSteps.round }).from(sheetApprovalSteps).where(eq(sheetApprovalSteps.sheetId, sheetId)).orderBy(asc(sheetApprovalSteps.round));
    const rounds = await Promise.all(roundNums.map(async ({ round }) => ({ round, steps: await this.sheetsSvc.stepsOf(sheetId, round) })));
    return { sheetId: r.sheet.id, audit: audit.map((a) => ({ ...a, actor: a.actor?.id ? a.actor : null })), rounds };
  }
}
```

`src/workflow/workflow.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { Roles } from '@/common/auth/roles.decorator';
import { WorkflowService } from './workflow.service';
import { ApproveDto, MarkPaidBulkDto, MarkPaidDto, ReasonDto, RejectDto, SubmitDto, WithdrawDto } from './workflow.dto';

@Controller('sheets')
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}
  private wrap = async (p: Promise<unknown>) => ({ data: await p });

  @Post('mark-paid') @HttpCode(200) @Roles('finance', 'admin')
  bulk(@Body() dto: MarkPaidBulkDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.markPaidBulk(a, dto.sheets, dto.paymentReference, dto.paidAt ? new Date(dto.paidAt) : undefined)); }

  @Get(':id/timeline') timeline(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.timeline(a, id)); }

  @Post(':id/submit') @HttpCode(200) submit(@Param('id', ParseUUIDPipe) id: string, @Body() d: SubmitDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.act(a, id, { type: 'submit', chain: [] }, d.version)); }
  @Post(':id/withdraw') @HttpCode(200) withdraw(@Param('id', ParseUUIDPipe) id: string, @Body() d: WithdrawDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.act(a, id, { type: 'withdraw' }, d.version)); }
  @Post(':id/approve') @HttpCode(200) approve(@Param('id', ParseUUIDPipe) id: string, @Body() d: ApproveDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.act(a, id, { type: 'approve', comment: d.comment, overrideReason: d.overrideReason }, d.version)); }
  @Post(':id/reject') @HttpCode(200) reject(@Param('id', ParseUUIDPipe) id: string, @Body() d: RejectDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.act(a, id, { type: 'reject', reason: d.reason, overrideReason: d.overrideReason }, d.version)); }
  @Post(':id/reopen') @HttpCode(200) @Roles('admin') reopen(@Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.act(a, id, { type: 'reopen', reason: d.reason }, d.version)); }
  @Post(':id/mark-paid') @HttpCode(200) @Roles('finance', 'admin') markPaid(@Param('id', ParseUUIDPipe) id: string, @Body() d: MarkPaidDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.act(a, id, { type: 'markPaid', paymentReference: d.paymentReference, paidAt: d.paidAt ? new Date(d.paidAt) : undefined }, d.version)); }
  @Post(':id/revert-paid') @HttpCode(200) @Roles('finance', 'admin') revertPaid(@Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto, @CurrentUser() a: AuthUser) { return this.wrap(this.workflow.act(a, id, { type: 'revertPaid', reason: d.reason }, d.version)); }
}
```
The `submit` handler passes an empty chain; `WorkflowService.act` replaces it with the real snapshot. Route order matters: `mark-paid` (static) is declared before `:id/...` so Fastify does not treat `mark-paid` as an id (ParseUUIDPipe would reject it anyway).

`src/workflow/workflow.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { SheetsModule } from '@/sheets/sheets.module';
import { ApprovalChainsModule } from '@/approval-chains/approval-chains.module';
import { WorkflowService } from './workflow.service';
import { WorkflowController } from './workflow.controller';
@Module({ imports: [SheetsModule, ApprovalChainsModule], controllers: [WorkflowController], providers: [WorkflowService], exports: [WorkflowService] })
export class WorkflowModule {}
```

Modify `src/app.module.ts`: add `EventEmitterModule.forRoot()` (from `@nestjs/event-emitter`) and `WorkflowModule` to imports.

- [ ] **Step 5: Run tests** — `pnpm vitest run test/workflow.e2e.spec.ts` → PASS (6). Then `pnpm test` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add workflow service with locked, versioned transitions, timeline and bulk mark-paid"
```

---

### Task 14: Approver inbox

**Files:**
- Create: `src/workflow/inbox.service.ts`, `src/workflow/inbox.controller.ts`, `src/workflow/inbox.dto.ts`
- Create: `test/inbox.e2e.spec.ts`
- Modify: `src/workflow/workflow.module.ts`

**Interfaces:**
- Produces: `InboxService.list(actor, scope: 'waiting' | 'upcoming' | 'decided', pagination)`; row shape `InboxRow = SheetSummary & { step: { position, label, status, decidedAt: Date | null } }`.
- Endpoint: `GET /approvals/inbox?scope=waiting|upcoming|decided&page&pageSize`.

- [ ] **Step 1: Write the failing test**

`test/inbox.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, submittedSheet } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

describe('inbox', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); });
  const tok = (u: { email: string; password: string }) => login(app, u.email, u.password).then((r) => r.accessToken);
  const inbox = (token: string, scope: string) => app.inject({ method: 'GET', url: `/api/v1/approvals/inbox?scope=${scope}`, headers: bearer(token) }).then((r) => r.json());

  it('shows waiting for the current approver and its backup, upcoming for later approvers', async () => {
    const s = await submittedSheet(app, db, (e, p) => login(app, e, p));
    const tl = await inbox(await tok(s.tl), 'waiting');
    expect(tl.meta.total).toBe(1); expect(tl.data[0]).toMatchObject({ id: s.sheetId, step: { position: 1, label: 'Tech Lead', status: 'pending' } });
    expect((await inbox(await tok(s.dm), 'waiting')).meta.total).toBe(1); // backup on step 1
    expect((await inbox(await tok(s.cto), 'waiting')).meta.total).toBe(0);
    expect((await inbox(await tok(s.cto), 'upcoming')).meta.total).toBe(1);
    expect((await inbox(s.empToken, 'waiting')).meta.total).toBe(0);
  });

  it('moves to decided after acting; admin sees all submitted sheets as waiting', async () => {
    const s = await submittedSheet(app, db, (e, p) => login(app, e, p));
    await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.sheetId}/approve`, headers: bearer(await tok(s.tl)), payload: { version: 2 } });
    expect((await inbox(await tok(s.tl), 'waiting')).meta.total).toBe(0);
    const decided = await inbox(await tok(s.tl), 'decided');
    expect(decided.data[0].step).toMatchObject({ position: 1, status: 'approved' });
    expect((await inbox(await tok(s.dm), 'waiting')).data[0].step.position).toBe(2);
    const admin = await createUser(db, { role: 'admin' });
    expect((await inbox(await tok(admin), 'waiting')).meta.total).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL 404.

- [ ] **Step 3: Implement**

`src/workflow/inbox.dto.ts`:
```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zPaginationQuery } from '@/common/zod';
export class InboxQueryDto extends createZodDto(zPaginationQuery.extend({ scope: z.enum(['waiting', 'upcoming', 'decided']).default('waiting') })) {}
```

`src/workflow/inbox.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, or, sql, SQL } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { sheetApprovalSteps, sheets, teams, users } from '@/database/schema';
import { AuthUser } from '@/common/auth/auth-user';
import { paged, Pagination } from '@/common/pagination';
import { SheetsService } from '@/sheets/sheets.service';

export type InboxScope = 'waiting' | 'upcoming' | 'decided';

@Injectable()
export class InboxService {
  constructor(private readonly drizzle: DrizzleService) {}

  async list(actor: AuthUser, scope: InboxScope, p: Pagination) {
    const db = this.drizzle.db;
    const mine = or(eq(sheetApprovalSteps.approverId, actor.id), eq(sheetApprovalSteps.backupApproverId, actor.id))!;
    const sameRound = eq(sheetApprovalSteps.round, sheets.round);
    let cond: SQL;
    if (scope === 'waiting') {
      const current = and(eq(sheets.status, 'submitted'), sameRound, eq(sheetApprovalSteps.position, sheets.currentStepPosition))!;
      cond = actor.role === 'admin' ? current : and(current, mine)!;
    } else if (scope === 'upcoming') {
      cond = and(eq(sheets.status, 'submitted'), sameRound, eq(sheetApprovalSteps.status, 'pending'), gt(sheetApprovalSteps.position, sheets.currentStepPosition), mine)!;
    } else {
      cond = eq(sheetApprovalSteps.decidedById, actor.id);
    }
    const base = db.select({
      sheet: sheets,
      employee: { id: users.id, firstName: users.firstName, lastName: users.lastName, employeeCode: users.employeeCode, teamId: users.teamId, teamName: teams.name },
      step: { position: sheetApprovalSteps.position, label: sheetApprovalSteps.label, status: sheetApprovalSteps.status, decidedAt: sheetApprovalSteps.decidedAt },
    }).from(sheetApprovalSteps).innerJoin(sheets, eq(sheets.id, sheetApprovalSteps.sheetId)).innerJoin(users, eq(users.id, sheets.employeeId)).leftJoin(teams, eq(teams.id, users.teamId)).where(cond);
    const order = scope === 'decided' ? desc(sheetApprovalSteps.decidedAt) : asc(sheets.submittedAt);
    const [rows, [{ total }]] = await Promise.all([
      base.orderBy(order).limit(p.limit).offset(p.offset),
      db.select({ total: count() }).from(sheetApprovalSteps).innerJoin(sheets, eq(sheets.id, sheetApprovalSteps.sheetId)).where(cond),
    ]);
    return paged(rows.map((r) => ({ ...SheetsService.toSummary({ sheet: r.sheet, employee: r.employee }), step: r.step })), Number(total), p);
  }
}
```

`src/workflow/inbox.controller.ts`:
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { parsePagination } from '@/common/pagination';
import { InboxService } from './inbox.service';
import { InboxQueryDto } from './inbox.dto';

@Controller('approvals/inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}
  @Get() list(@Query() q: InboxQueryDto, @CurrentUser() actor: AuthUser) { return this.inbox.list(actor, q.scope, parsePagination(q)); }
}
```

Add `InboxService` to providers and `InboxController` to controllers in `WorkflowModule`.

- [ ] **Step 4: Run tests** → PASS (2).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add approver inbox with waiting, upcoming and decided scopes"
```

---

### Task 15: Notifications (in-app + email) and monthly reminder

**Files:**
- Create: `src/notifications/notifications.module.ts`, `notifications.service.ts`, `notifications.listener.ts`, `notifications.controller.ts`, `reminder.service.ts`, `notifications.dto.ts`
- Create: `test/notifications.e2e.spec.ts`
- Modify: `src/app.module.ts` (NotificationsModule, `ScheduleModule.forRoot()`)

**Interfaces:**
- Produces: `NotificationsService.notify(userIds: string[], n: { type: string; title: string; body: string; link: string | null }, email?: { subject: string; html: string })`; `NotificationsService.listFor(userId, unreadOnly, pagination)`, `markRead(userId, id)`, `markAllRead(userId)`, `unreadCount(userId)`; `ReminderService.runMonthlyReminder(today: Date)` (idempotent per day via audit? no: it only sends in-app+email; safe to run daily because it checks `reminderDayOfMonth`).
- Endpoints: `GET /me/notifications?unreadOnly&page` → `{ data, meta: { ..., unread } }`, `POST /me/notifications/:id/read`, `POST /me/notifications/read-all`.
- Notification matrix (spec 5.5): see listener code.

- [ ] **Step 1: Install**

```bash
pnpm add @nestjs/schedule@^6
```

- [ ] **Step 2: Write the failing test**

`test/notifications.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam, createChain, createOvertimeType, createSheet, createEntry, submittedSheet } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { MailService } from '@/mail/mail.service';
import { ReminderService } from '@/notifications/reminder.service';

const flush = () => new Promise((r) => setTimeout(r, 50));

describe('notifications', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let mail: MailService;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; mail = app.get(MailService); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); mail.sent.length = 0; });
  const tok = (u: { email: string; password: string }) => login(app, u.email, u.password).then((r) => r.accessToken);
  const list = (token: string) => app.inject({ method: 'GET', url: '/api/v1/me/notifications', headers: bearer(token) }).then((r) => r.json());

  it('notifies the first approver and backup on submit (in-app + email)', async () => {
    const s = await submittedSheet(app, db, (e, p) => login(app, e, p));
    await flush();
    const tl = await list(await tok(s.tl));
    expect(tl.meta.unread).toBe(1); expect(tl.data[0]).toMatchObject({ type: 'sheet.submitted', link: `/approvals/${s.sheetId}` });
    expect((await list(await tok(s.dm))).meta.unread).toBe(1);
    expect((await list(await tok(s.cto))).meta.unread).toBe(0);
    expect(mail.sent.map((m) => m.to).sort()).toEqual([s.dm.email, s.tl.email].sort());
  });

  it('step approval notifies employee (in-app) and next approver (both); final approval notifies employee and finance', async () => {
    const s = await submittedSheet(app, db, (e, p) => login(app, e, p));
    const fin = await createUser(db, { role: 'finance' });
    await flush(); mail.sent.length = 0;
    await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.sheetId}/approve`, headers: bearer(await tok(s.tl)), payload: { version: 2 } });
    await flush();
    expect((await list(s.empToken)).data[0].type).toBe('sheet.step_approved');
    expect(mail.sent.map((m) => m.to)).toEqual([s.dm.email]);
    await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.sheetId}/approve`, headers: bearer(await tok(s.dm)), payload: { version: 3 } });
    await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.sheetId}/approve`, headers: bearer(await tok(s.cto)), payload: { version: 4 } });
    await flush();
    expect((await list(s.empToken)).data[0].type).toBe('sheet.approved');
    expect((await list(await tok(fin))).data[0].type).toBe('sheet.approved');
    expect(mail.sent.at(-1)?.to).toBe(s.emp.email);
  });

  it('rejection email carries the reason; mark read and read-all work', async () => {
    const s = await submittedSheet(app, db, (e, p) => login(app, e, p));
    await flush(); mail.sent.length = 0;
    await app.inject({ method: 'POST', url: `/api/v1/sheets/${s.sheetId}/reject`, headers: bearer(await tok(s.tl)), payload: { version: 2, reason: 'Missing links' } });
    await flush();
    expect(mail.sent[0].to).toBe(s.emp.email); expect(mail.sent[0].html).toContain('Missing links');
    const mine = await list(s.empToken);
    await app.inject({ method: 'POST', url: `/api/v1/me/notifications/${mine.data[0].id}/read`, headers: bearer(s.empToken) });
    expect((await list(s.empToken)).meta.unread).toBe(0);
    await app.inject({ method: 'POST', url: `/api/v1/me/notifications/read-all`, headers: bearer(await tok(s.tl)) });
    expect((await list(await tok(s.tl))).meta.unread).toBe(0);
  });

  it('monthly reminder targets employees with a non-empty draft for the previous month', async () => {
    const team = await createTeam(db); const type = await createOvertimeType(db);
    const withDraft = await createUser(db, { teamId: team.id }); const sheet = await createSheet(db, withDraft.id, '2026-09'); await createEntry(db, sheet.id, type.id);
    const emptyDraft = await createUser(db, { teamId: team.id }); await createSheet(db, emptyDraft.id, '2026-09');
    await app.get(ReminderService).runMonthlyReminder(new Date('2026-10-01T08:00:00Z'));
    expect(mail.sent.map((m) => m.to)).toEqual([withDraft.email]);
    expect((await list(await tok(withDraft))).data[0].type).toBe('sheet.reminder');
    mail.sent.length = 0;
    await app.get(ReminderService).runMonthlyReminder(new Date('2026-10-02T08:00:00Z'));
    expect(mail.sent).toHaveLength(0); // not the reminder day
  });
});
```

- [ ] **Step 3: Run to verify it fails** → FAIL.

- [ ] **Step 4: Implement**

`src/notifications/notifications.dto.ts`:
```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zPaginationQuery } from '@/common/zod';
export class ListNotificationsQueryDto extends createZodDto(zPaginationQuery.extend({ unreadOnly: z.enum(['true', 'false']).transform((v) => v === 'true').optional() })) {}
```

`src/notifications/notifications.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { notifications, users } from '@/database/schema';
import { Pagination } from '@/common/pagination';
import { MailService } from '@/mail/mail.service';

export interface NotificationInput { type: string; title: string; body: string; link: string | null }

@Injectable()
export class NotificationsService {
  constructor(private readonly drizzle: DrizzleService, private readonly mail: MailService) {}

  async notify(userIds: string[], n: NotificationInput, email?: { subject: string; html: string }): Promise<void> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    await this.drizzle.db.insert(notifications).values(ids.map((userId) => ({ userId, ...n })));
    if (email) {
      const rows = await this.drizzle.db.select({ email: users.email }).from(users).where(and(inArray(users.id, ids), eq(users.isActive, true)));
      await Promise.all(rows.map((r) => this.mail.send({ to: r.email, ...email })));
    }
  }

  async listFor(userId: string, unreadOnly: boolean, p: Pagination) {
    const cond = unreadOnly ? and(eq(notifications.userId, userId), isNull(notifications.readAt)) : eq(notifications.userId, userId);
    const [rows, [{ total }], unread] = await Promise.all([
      this.drizzle.db.select().from(notifications).where(cond).orderBy(desc(notifications.createdAt)).limit(p.limit).offset(p.offset),
      this.drizzle.db.select({ total: count() }).from(notifications).where(cond),
      this.unreadCount(userId),
    ]);
    return { data: rows, meta: { page: p.page, pageSize: p.pageSize, total: Number(total), unread } };
  }

  async unreadCount(userId: string): Promise<number> {
    const [{ n }] = await this.drizzle.db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return Number(n);
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.drizzle.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)));
  }

  async markAllRead(userId: string): Promise<void> {
    await this.drizzle.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }
}
```

`src/notifications/notifications.listener.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { sheets, users } from '@/database/schema';
import { Env } from '@/common/config/env';
import { dateToPeriod } from '@/common/zod';
import { genericEmail } from '@/mail/templates';
import { WorkflowEvent } from '@/workflow/transition';
import { NotificationsService } from './notifications.service';
import { UsersService } from '@/users/users.service';

type P = WorkflowEvent['payload'];

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);
  constructor(private readonly drizzle: DrizzleService, private readonly notifications: NotificationsService, private readonly users: UsersService, private readonly config: ConfigService<Env, true>) {}

  private async context(p: P) {
    const [row] = await this.drizzle.db.select({ period: sheets.period, firstName: users.firstName, lastName: users.lastName }).from(sheets).innerJoin(users, eq(users.id, sheets.employeeId)).where(eq(sheets.id, p.sheetId));
    const period = row ? dateToPeriod(row.period) : '';
    return { period, name: row ? `${row.firstName} ${row.lastName}` : 'An employee', web: this.config.get('WEB_URL') };
  }

  private safe(fn: () => Promise<void>) { return fn().catch((e) => this.logger.error(`notification failed: ${(e as Error).message}`)); }

  @OnEvent('sheet.submitted', { async: true })
  onSubmitted(p: P) { return this.safe(async () => {
    const c = await this.context(p); const link = `/approvals/${p.sheetId}`;
    await this.notifications.notify(p.approverIds, { type: 'sheet.submitted', title: 'Overtime sheet awaiting your approval', body: `${c.name} submitted the ${c.period} overtime sheet.`, link },
      genericEmail('Overtime sheet awaiting your approval', `${c.name} submitted the ${c.period} overtime sheet. Please review it.`, { label: 'Review sheet', href: `${c.web}${link}` }));
  }); }

  @OnEvent('sheet.step_approved', { async: true })
  onStepApproved(p: P) { return this.safe(async () => {
    const c = await this.context(p);
    await this.notifications.notify([p.employeeId], { type: 'sheet.step_approved', title: 'A step of your sheet was approved', body: `Your ${c.period} sheet moved to the next approver.`, link: `/sheets/${p.sheetId}` });
    await this.notifications.notify(p.approverIds, { type: 'sheet.submitted', title: 'Overtime sheet awaiting your approval', body: `${c.name}'s ${c.period} sheet is now at your step.`, link: `/approvals/${p.sheetId}` },
      genericEmail('Overtime sheet awaiting your approval', `${c.name}'s ${c.period} overtime sheet is now at your step.`, { label: 'Review sheet', href: `${c.web}/approvals/${p.sheetId}` }));
  }); }

  @OnEvent('sheet.approved', { async: true })
  onApproved(p: P) { return this.safe(async () => {
    const c = await this.context(p);
    await this.notifications.notify([p.employeeId], { type: 'sheet.approved', title: 'Your overtime sheet was approved', body: `Your ${c.period} sheet is fully approved and waiting for payment.`, link: `/sheets/${p.sheetId}` },
      genericEmail('Your overtime sheet was approved', `Your ${c.period} overtime sheet is fully approved and has been passed to finance.`, { label: 'Open sheet', href: `${c.web}/sheets/${p.sheetId}` }));
    const finance = await this.users.listByRole('finance');
    await this.notifications.notify(finance.map((f) => f.id), { type: 'sheet.approved', title: 'Sheet ready for payment', body: `${c.name}'s ${c.period} sheet is approved.`, link: `/payments` });
  }); }

  @OnEvent('sheet.rejected', { async: true })
  onRejected(p: P) { return this.safe(async () => {
    const c = await this.context(p);
    await this.notifications.notify([p.employeeId], { type: 'sheet.rejected', title: 'Your overtime sheet was rejected', body: `Reason: ${p.reason ?? ''}`, link: `/sheets/${p.sheetId}` },
      genericEmail('Your overtime sheet was rejected', `Your ${c.period} overtime sheet was rejected. Reason: ${p.reason ?? ''}. Fix it and resubmit.`, { label: 'Open sheet', href: `${c.web}/sheets/${p.sheetId}` }));
  }); }

  @OnEvent('sheet.withdrawn', { async: true })
  onWithdrawn(p: P) { return this.safe(async () => {
    const c = await this.context(p);
    await this.notifications.notify(p.approverIds, { type: 'sheet.withdrawn', title: 'Sheet withdrawn', body: `${c.name} withdrew the ${c.period} sheet.`, link: null });
  }); }

  @OnEvent('sheet.reopened', { async: true })
  onReopened(p: P) { return this.safe(async () => {
    const c = await this.context(p);
    await this.notifications.notify([p.employeeId], { type: 'sheet.reopened', title: 'Your sheet was reopened by an admin', body: `Reason: ${p.reason ?? ''}`, link: `/sheets/${p.sheetId}` });
  }); }

  @OnEvent('sheet.paid', { async: true })
  onPaid(p: P) { return this.safe(async () => {
    const c = await this.context(p);
    await this.notifications.notify([p.employeeId], { type: 'sheet.paid', title: 'Your overtime was paid', body: `Your ${c.period} sheet is marked as paid.`, link: `/sheets/${p.sheetId}` },
      genericEmail('Your overtime was paid', `Your ${c.period} overtime sheet has been marked as paid.`, { label: 'Open sheet', href: `${c.web}/sheets/${p.sheetId}` }));
  }); }

  @OnEvent('sheet.payment_reverted', { async: true })
  onPaymentReverted(p: P) { return this.safe(async () => {
    const c = await this.context(p);
    await this.notifications.notify([p.employeeId], { type: 'sheet.payment_reverted', title: 'Payment status reverted', body: `Your ${c.period} sheet is back to approved. Reason: ${p.reason ?? ''}`, link: `/sheets/${p.sheetId}` });
  }); }
}
```

`src/notifications/reminder.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { and, eq, exists, sql } from 'drizzle-orm';
import { formatInTimeZone } from 'date-fns-tz';
import { subMonths } from 'date-fns';
import { DrizzleService } from '@/database/drizzle.service';
import { settings, sheetEntries, sheets, users } from '@/database/schema';
import { Env } from '@/common/config/env';
import { genericEmail } from '@/mail/templates';
import { NotificationsService } from './notifications.service';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);
  constructor(private readonly drizzle: DrizzleService, private readonly notifications: NotificationsService, private readonly config: ConfigService<Env, true>) {}

  @Cron('0 8 * * *')
  cron() { return this.runMonthlyReminder(new Date()); }

  async runMonthlyReminder(now: Date): Promise<void> {
    const [s] = await this.drizzle.db.select().from(settings);
    const tz = s?.defaultTimezone ?? this.config.get('DEFAULT_TIMEZONE');
    const day = Number(formatInTimeZone(now, tz, 'd'));
    if (day !== (s?.reminderDayOfMonth ?? 1)) return;
    const prev = formatInTimeZone(subMonths(now, 1), tz, 'yyyy-MM');
    const rows = await this.drizzle.db.select({ id: users.id, firstName: users.firstName, sheetId: sheets.id }).from(sheets).innerJoin(users, eq(users.id, sheets.employeeId))
      .where(and(eq(sheets.status, 'draft'), eq(sheets.period, `${prev}-01`), eq(users.isActive, true), exists(this.drizzle.db.select({ one: sql`1` }).from(sheetEntries).where(eq(sheetEntries.sheetId, sheets.id)))));
    this.logger.log(`Monthly reminder: ${rows.length} draft sheet(s) for ${prev}`);
    for (const r of rows) {
      await this.notifications.notify([r.id], { type: 'sheet.reminder', title: `Submit your ${prev} overtime sheet`, body: 'Your sheet from last month is still a draft.', link: `/sheets/${r.sheetId}` },
        genericEmail(`Submit your ${prev} overtime sheet`, `Hi ${r.firstName}, your ${prev} overtime sheet still has unsubmitted entries. Submit it so it can be approved and paid.`, { label: 'Open sheet', href: `${this.config.get('WEB_URL')}/sheets/${r.sheetId}` }));
    }
  }
}
```

`src/notifications/notifications.controller.ts`:
```ts
import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { parsePagination } from '@/common/pagination';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './notifications.dto';

@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get() list(@Query() q: ListNotificationsQueryDto, @CurrentUser() u: AuthUser) { return this.notifications.listFor(u.id, q.unreadOnly ?? false, parsePagination(q)); }
  @Post('read-all') @HttpCode(204) async readAll(@CurrentUser() u: AuthUser) { await this.notifications.markAllRead(u.id); }
  @Post(':id/read') @HttpCode(204) async read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { await this.notifications.markRead(u.id, id); }
}
```

`src/notifications/notifications.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { UsersModule } from '@/users/users.module';
import { NotificationsService } from './notifications.service';
import { NotificationsListener } from './notifications.listener';
import { NotificationsController } from './notifications.controller';
import { ReminderService } from './reminder.service';
@Module({ imports: [UsersModule], controllers: [NotificationsController], providers: [NotificationsService, NotificationsListener, ReminderService], exports: [NotificationsService] })
export class NotificationsModule {}
```

Modify `src/app.module.ts`: add `ScheduleModule.forRoot()` and `NotificationsModule`.

- [ ] **Step 5: Run tests** → PASS (4). Then `pnpm test` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add in-app and email notifications driven by workflow events, plus monthly reminder"
```

---

### Task 16: Team month report

**Files:**
- Create: `src/reports/reports.module.ts`, `reports.controller.ts`, `team-month.service.ts`, `reports.dto.ts`
- Create: `test/reports.e2e.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Produces: `TeamMonthService.build(actor, { teamId, period, status? }) → TeamMonthReport`:
```ts
interface TeamMonthReport {
  team: { id: string; name: string }; period: string;
  types: Array<{ id: string; name: string; multiplier: number; color: string }>;   // every type referenced by an entry + active types
  rows: Array<{ employee: { id, firstName, lastName, employeeCode }; sheet: SheetSummary | null; hoursByType: Record<string, number>; totalHours: number; totalWeightedHours: number; entries: EntryView[] }>;
  totals: { totalHours: number; totalWeightedHours: number; hoursByType: Record<string, number> };
}
```
  Throws `FORBIDDEN` when the team is not in `VisibilityService.visibleTeamIds(actor)`. `TeamMonthService.buildAll(actor, { period, teamId?, status? })` returns `TeamMonthReport[]` for every visible team (used by the all-employees export).
- Endpoint: `GET /reports/team-month?teamId&period&status`.

- [ ] **Step 1: Write the failing test**

`test/reports.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createTeam, createChain, createOvertimeType, createSheet, createEntry } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

describe('team month report', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(db); });
  const tok = (u: { email: string; password: string }) => login(app, u.email, u.password).then((r) => r.accessToken);

  async function fixture() {
    const tl = await createUser(db, { role: 'tech_lead' }); const team = await createTeam(db, { name: 'Platform', techLeadId: tl.id });
    await createChain(db, team.id, [{ label: 'TL', approverId: tl.id }]);
    const weekday = await createOvertimeType(db, { name: 'Weekday', multiplier: '1.50' }); const weekend = await createOvertimeType(db, { name: 'Weekend', multiplier: '2.00' });
    const a = await createUser(db, { teamId: team.id, firstName: 'Ann' }); const b = await createUser(db, { teamId: team.id, firstName: 'Bob' }); const c = await createUser(db, { teamId: team.id, firstName: 'Cid' });
    const sa = await createSheet(db, a.id, '2026-09'); await createEntry(db, sa.id, weekday.id, { hours: '2.00', multiplier: '1.50', date: '2026-09-01' }); await createEntry(db, sa.id, weekend.id, { hours: '4.00', multiplier: '2.00', date: '2026-09-05' });
    const sb = await createSheet(db, b.id, '2026-09'); await createEntry(db, sb.id, weekday.id, { hours: '1.00', multiplier: '1.50' });
    await db.execute(`update sheets set total_hours = (select coalesce(sum(hours),0) from sheet_entries e where e.sheet_id = sheets.id), total_weighted_hours = (select coalesce(sum(weighted_hours),0) from sheet_entries e where e.sheet_id = sheets.id)` as never);
    return { tl, team, a, b, c, weekday, weekend };
  }

  it('aggregates hours per type per employee, includes members without a sheet, and totals', async () => {
    const f = await fixture();
    const res = await app.inject({ method: 'GET', url: `/api/v1/reports/team-month?teamId=${f.team.id}&period=2026-09`, headers: bearer(await tok(f.tl)) });
    expect(res.statusCode).toBe(200);
    const r = res.json().data;
    expect(r.team.name).toBe('Platform'); expect(r.period).toBe('2026-09');
    expect(r.rows.map((x: { employee: { firstName: string } }) => x.employee.firstName)).toEqual(['Ann', 'Bob', 'Cid']);
    expect(r.rows[0]).toMatchObject({ totalHours: 6, totalWeightedHours: 11, hoursByType: { [f.weekday.id]: 2, [f.weekend.id]: 4 } });
    expect(r.rows[0].entries).toHaveLength(2);
    expect(r.rows[2]).toMatchObject({ sheet: null, totalHours: 0, entries: [] });
    expect(r.totals).toEqual({ totalHours: 7, totalWeightedHours: 12.5, hoursByType: { [f.weekday.id]: 3, [f.weekend.id]: 4 } });
  });

  it('enforces team visibility', async () => {
    const f = await fixture();
    const stranger = await createUser(db, { role: 'tech_lead' });
    expect((await app.inject({ method: 'GET', url: `/api/v1/reports/team-month?teamId=${f.team.id}&period=2026-09`, headers: bearer(await tok(stranger)) })).statusCode).toBe(403);
    const fin = await createUser(db, { role: 'finance' });
    expect((await app.inject({ method: 'GET', url: `/api/v1/reports/team-month?teamId=${f.team.id}&period=2026-09`, headers: bearer(await tok(fin)) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/reports/team-month?teamId=${f.team.id}&period=2026-09`, headers: bearer(await tok(f.a)) })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL 404.

- [ ] **Step 3: Implement**

`src/reports/reports.dto.ts`:
```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { sheetStatusEnum } from '@/database/schema';
import { zPeriod, zUuid } from '@/common/zod';
const status = z.enum(sheetStatusEnum.enumValues).optional();
export class TeamMonthQueryDto extends createZodDto(z.object({ teamId: zUuid, period: zPeriod, status })) {}
export class TeamMonthExportQueryDto extends createZodDto(z.object({ teamId: zUuid, period: zPeriod, status, format: z.enum(['xlsx', 'csv']).default('xlsx') })) {}
export class EmployeesExportQueryDto extends createZodDto(z.object({ period: zPeriod, teamId: zUuid.optional(), status, format: z.enum(['xlsx', 'csv']).default('xlsx') })) {}
```

`src/reports/team-month.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { overtimeTypes, sheets, teams, users, SheetStatus } from '@/database/schema';
import { AuthUser } from '@/common/auth/auth-user';
import { forbidden, notFound } from '@/common/errors/domain-error';
import { periodToDate } from '@/common/zod';
import { SheetsService, SheetSummary } from '@/sheets/sheets.service';
import { VisibilityService } from '@/sheets/visibility.service';

type EntryView = Awaited<ReturnType<SheetsService['entriesOf']>>[number];
export interface TeamMonthRow { employee: { id: string; firstName: string; lastName: string; employeeCode: string | null }; sheet: SheetSummary | null; hoursByType: Record<string, number>; totalHours: number; totalWeightedHours: number; entries: EntryView[] }
export interface TeamMonthReport { team: { id: string; name: string }; period: string; types: Array<{ id: string; name: string; multiplier: number; color: string }>; rows: TeamMonthRow[]; totals: { totalHours: number; totalWeightedHours: number; hoursByType: Record<string, number> } }

const r2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class TeamMonthService {
  constructor(private readonly drizzle: DrizzleService, private readonly sheetsSvc: SheetsService, private readonly visibility: VisibilityService) {}

  async build(actor: AuthUser, q: { teamId: string; period: string; status?: SheetStatus }): Promise<TeamMonthReport> {
    const visible = await this.visibility.visibleTeamIds(actor);
    if (visible !== 'all' && !visible.includes(q.teamId)) throw forbidden('You cannot view this team');
    return this.buildUnchecked(q);
  }

  async buildAll(actor: AuthUser, q: { period: string; teamId?: string; status?: SheetStatus }): Promise<TeamMonthReport[]> {
    const visible = await this.visibility.visibleTeamIds(actor);
    const teamRows = await this.drizzle.db.select({ id: teams.id }).from(teams).where(visible === 'all' ? eq(teams.isActive, true) : and(eq(teams.isActive, true), inArray(teams.id, visible.length ? visible : ['00000000-0000-0000-0000-000000000000']))).orderBy(asc(teams.name));
    const ids = teamRows.map((t) => t.id).filter((id) => !q.teamId || id === q.teamId);
    if (q.teamId && !ids.includes(q.teamId)) throw forbidden('You cannot view this team');
    return Promise.all(ids.map((teamId) => this.buildUnchecked({ teamId, period: q.period, status: q.status })));
  }

  private async buildUnchecked(q: { teamId: string; period: string; status?: SheetStatus }): Promise<TeamMonthReport> {
    const db = this.drizzle.db;
    const [team] = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.id, q.teamId));
    if (!team) throw notFound('Team');
    const members = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, employeeCode: users.employeeCode }).from(users).where(and(eq(users.teamId, q.teamId), eq(users.isActive, true))).orderBy(asc(users.firstName), asc(users.lastName));
    const sheetRows = await db.select({ sheet: sheets, employee: { id: users.id, firstName: users.firstName, lastName: users.lastName, employeeCode: users.employeeCode, teamId: users.teamId, teamName: teams.name } })
      .from(sheets).innerJoin(users, eq(users.id, sheets.employeeId)).leftJoin(teams, eq(teams.id, users.teamId))
      .where(and(eq(sheets.period, periodToDate(q.period)), eq(users.teamId, q.teamId), q.status ? eq(sheets.status, q.status) : undefined));
    const byEmployee = new Map(sheetRows.map((r) => [r.sheet.employeeId, r]));
    const typeRows = await db.select().from(overtimeTypes).orderBy(asc(overtimeTypes.sortOrder));
    const usedTypeIds = new Set<string>();
    const rows: TeamMonthRow[] = [];
    for (const m of members) {
      const s = byEmployee.get(m.id);
      const entries = s ? await this.sheetsSvc.entriesOf(s.sheet.id) : [];
      const hoursByType: Record<string, number> = {};
      for (const e of entries) { hoursByType[e.overtimeType.id] = r2((hoursByType[e.overtimeType.id] ?? 0) + e.hours); usedTypeIds.add(e.overtimeType.id); }
      rows.push({ employee: m, sheet: s ? SheetsService.toSummary(s) : null, hoursByType, totalHours: r2(entries.reduce((a, e) => a + e.hours, 0)), totalWeightedHours: r2(entries.reduce((a, e) => a + e.weightedHours, 0)), entries });
    }
    const types = typeRows.filter((t) => t.isActive || usedTypeIds.has(t.id)).map((t) => ({ id: t.id, name: t.name, multiplier: Number(t.multiplier), color: t.color }));
    const totals = { totalHours: r2(rows.reduce((a, r) => a + r.totalHours, 0)), totalWeightedHours: r2(rows.reduce((a, r) => a + r.totalWeightedHours, 0)), hoursByType: {} as Record<string, number> };
    for (const r of rows) for (const [k, v] of Object.entries(r.hoursByType)) totals.hoursByType[k] = r2((totals.hoursByType[k] ?? 0) + v);
    return { team, period: q.period, types, rows, totals };
  }
}
```

`src/reports/reports.controller.ts` (export routes are added in Task 17):
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { TeamMonthService } from './team-month.service';
import { TeamMonthQueryDto } from './reports.dto';

@Controller('reports')
export class ReportsController {
  constructor(private readonly teamMonth: TeamMonthService) {}
  @Get('team-month') async teamMonthReport(@Query() q: TeamMonthQueryDto, @CurrentUser() a: AuthUser) { return { data: await this.teamMonth.build(a, q) }; }
}
```

`src/reports/reports.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { SheetsModule } from '@/sheets/sheets.module';
import { ReportsController } from './reports.controller';
import { TeamMonthService } from './team-month.service';
@Module({ imports: [SheetsModule], controllers: [ReportsController], providers: [TeamMonthService], exports: [TeamMonthService] })
export class ReportsModule {}
```

Add to `AppModule`. In the test fixture the raw `db.execute` of a string is replaced by `sql` template: `import { sql } from 'drizzle-orm'` and `await db.execute(sql\`update sheets set ...\`)`.

- [ ] **Step 4: Run tests** → PASS (2).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add team month report with per-type aggregation and visibility checks"
```

---

### Task 17: XLSX and CSV exports

**Files:**
- Create: `src/reports/export.service.ts`, `src/reports/export.service.spec.ts`
- Modify: `src/reports/reports.controller.ts`, `src/reports/reports.module.ts`, `test/reports.e2e.spec.ts` (add export tests)

**Interfaces:**
- Produces: `ExportService.toXlsx(reports: TeamMonthReport[]) → Promise<Buffer>` (sheets "Summary" and "Details"), `ExportService.toCsv(reports) → string` (Details layout), `ExportService.fileName(scope: 'team' | 'all', teamName: string | null, period, format)`.
- Endpoints: `GET /reports/team-month/export?teamId&period&status&format`, `GET /reports/employees/export?period&teamId&status&format` (both restricted to roles tech_lead, delivery_manager, cto, finance, admin; visibility enforced by `TeamMonthService`).

- [ ] **Step 1: Install and write the failing unit test**

```bash
pnpm add exceljs@^4
```

`src/reports/export.service.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { ExportService } from './export.service';
import { TeamMonthReport } from './team-month.service';

const report: TeamMonthReport = {
  team: { id: 't1', name: 'Platform' }, period: '2026-09',
  types: [{ id: 'wd', name: 'Weekday', multiplier: 1.5, color: '#000' }, { id: 'we', name: 'Weekend', multiplier: 2, color: '#000' }],
  rows: [{
    employee: { id: 'e1', firstName: 'Ann', lastName: 'Lee', employeeCode: 'E1' },
    sheet: { id: 's1', period: '2026-09', status: 'approved', round: 1, currentStepPosition: null, totalHours: 6, totalWeightedHours: 11, submittedAt: new Date('2026-10-01T00:00:00Z'), approvedAt: new Date('2026-10-02T00:00:00Z'), rejectedAt: null, rejectionReason: null, paidAt: null, paymentReference: null, version: 4, employee: { id: 'e1', firstName: 'Ann', lastName: 'Lee', employeeCode: 'E1', teamId: 't1', teamName: 'Platform' } },
    hoursByType: { wd: 2, we: 4 }, totalHours: 6, totalWeightedHours: 11,
    entries: [
      { id: 'x1', date: '2026-09-01', startTime: '18:00', endTime: '20:00', hours: 2, multiplier: 1.5, weightedHours: 3, overtimeType: { id: 'wd', name: 'Weekday', color: '#000' }, workItem: 'PROJ-1', workItemUrl: null, description: 'Hotfix', requestedBy: null, attachment: null },
      { id: 'x2', date: '2026-09-05', startTime: '10:00', endTime: '14:00', hours: 4, multiplier: 2, weightedHours: 8, overtimeType: { id: 'we', name: 'Weekend', color: '#000' }, workItem: 'PROJ-2', workItemUrl: 'https://j/PROJ-2', description: 'Release', requestedBy: { id: 'm', firstName: 'Max', lastName: 'Po' }, attachment: null },
    ],
  }, { employee: { id: 'e2', firstName: 'Bob', lastName: 'Ray', employeeCode: null }, sheet: null, hoursByType: {}, totalHours: 0, totalWeightedHours: 0, entries: [] }],
  totals: { totalHours: 6, totalWeightedHours: 11, hoursByType: { wd: 2, we: 4 } },
};

describe('ExportService', () => {
  const svc = new ExportService();
  it('builds an xlsx with Summary and Details sheets', async () => {
    const buf = await svc.toXlsx([report]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const summary = wb.getWorksheet('Summary')!; const details = wb.getWorksheet('Details')!;
    expect(summary.getRow(1).values).toEqual([undefined, 'Employee code', 'Employee', 'Team', 'Period', 'Weekday (h)', 'Weekend (h)', 'Total hours', 'Weighted hours', 'Status', 'Submitted at', 'Approved at', 'Paid at', 'Payment reference']);
    expect(summary.getRow(2).getCell(2).value).toBe('Ann Lee'); expect(summary.getRow(2).getCell(9).value).toBe(11);
    expect(summary.getRow(3).getCell(10).value).toBe('no sheet');
    expect(details.rowCount).toBe(3);
    expect(details.getRow(3).getCell(11).value).toBe('PROJ-2'); expect(details.getRow(3).getCell(14).value).toBe('Max Po');
  });
  it('builds csv with the Details layout', () => {
    const csv = svc.toCsv([report]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Employee code,Employee,Team,Period,Date,Start,End,Hours,Type,Multiplier,Weighted hours,Work item,Work item URL,Description,Requested by,Sheet status');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Hotfix"');
  });
  it('names files', () => {
    expect(svc.fileName('team', 'Platform Team', '2026-09', 'xlsx')).toBe('overtrack-platform-team-2026-09.xlsx');
    expect(svc.fileName('all', null, '2026-09', 'csv')).toBe('overtrack-all-2026-09.csv');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`src/reports/export.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { TeamMonthReport } from './team-month.service';

const DETAIL_HEADERS = ['Employee code', 'Employee', 'Team', 'Period', 'Date', 'Start', 'End', 'Hours', 'Type', 'Multiplier', 'Weighted hours', 'Work item', 'Work item URL', 'Description', 'Requested by', 'Sheet status'];
const fullName = (p: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}` : '');
const iso = (d: Date | null) => (d ? d.toISOString() : '');

@Injectable()
export class ExportService {
  private detailRows(reports: TeamMonthReport[]): Array<Array<string | number>> {
    const out: Array<Array<string | number>> = [];
    for (const r of reports) for (const row of r.rows) for (const e of row.entries) {
      out.push([row.employee.employeeCode ?? '', fullName(row.employee), r.team.name, r.period, e.date, e.startTime, e.endTime, e.hours, e.overtimeType.name, e.multiplier, e.weightedHours, e.workItem, e.workItemUrl ?? '', e.description, fullName(e.requestedBy), row.sheet?.status ?? '']);
    }
    return out;
  }

  async toXlsx(reports: TeamMonthReport[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const typeIds = [...new Map(reports.flatMap((r) => r.types).map((t) => [t.id, t])).values()];
    const summary = wb.addWorksheet('Summary');
    summary.addRow(['Employee code', 'Employee', 'Team', 'Period', ...typeIds.map((t) => `${t.name} (h)`), 'Total hours', 'Weighted hours', 'Status', 'Submitted at', 'Approved at', 'Paid at', 'Payment reference']);
    for (const r of reports) for (const row of r.rows) {
      summary.addRow([row.employee.employeeCode ?? '', fullName(row.employee), r.team.name, r.period, ...typeIds.map((t) => row.hoursByType[t.id] ?? 0), row.totalHours, row.totalWeightedHours, row.sheet?.status ?? 'no sheet', iso(row.sheet?.submittedAt ?? null), iso(row.sheet?.approvedAt ?? null), iso(row.sheet?.paidAt ?? null), row.sheet?.paymentReference ?? '']);
    }
    const details = wb.addWorksheet('Details');
    details.addRow(DETAIL_HEADERS);
    for (const row of this.detailRows(reports)) details.addRow(row);
    for (const ws of [summary, details]) { ws.getRow(1).font = { bold: true }; ws.columns.forEach((c) => { c.width = 18; }); ws.views = [{ state: 'frozen', ySplit: 1 }]; }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  toCsv(reports: TeamMonthReport[]): string {
    const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [DETAIL_HEADERS.join(','), ...this.detailRows(reports).map((r) => r.map((c, i) => (i === 13 ? `"${String(c).replace(/"/g, '""')}"` : esc(c))).join(','))];
    return lines.join('\n') + '\n';
  }

  fileName(scope: 'team' | 'all', teamName: string | null, period: string, format: 'xlsx' | 'csv'): string {
    const slug = scope === 'all' ? 'all' : (teamName ?? 'team').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `overtrack-${slug}-${period}.${format}`;
  }
}
```

Add to `src/reports/reports.controller.ts`:
```ts
import { Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { Roles } from '@/common/auth/roles.decorator';
import { MANAGER_ROLES } from '@/common/auth/auth-user';
import { ExportService } from './export.service';
import { EmployeesExportQueryDto, TeamMonthExportQueryDto } from './reports.dto';
// constructor gains: private readonly exporter: ExportService

  private async sendExport(reply: FastifyReply, reports: TeamMonthReport[], name: string, format: 'xlsx' | 'csv') {
    const body = format === 'xlsx' ? await this.exporter.toXlsx(reports) : this.exporter.toCsv(reports);
    reply.header('content-type', format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${name}"`);
    return reply.send(body);
  }

  @Get('team-month/export') @Roles(...MANAGER_ROLES)
  async exportTeam(@Query() q: TeamMonthExportQueryDto, @CurrentUser() a: AuthUser, @Res() reply: FastifyReply) {
    const report = await this.teamMonth.build(a, q);
    return this.sendExport(reply, [report], this.exporter.fileName('team', report.team.name, q.period, q.format), q.format);
  }

  @Get('employees/export') @Roles(...MANAGER_ROLES)
  async exportAll(@Query() q: EmployeesExportQueryDto, @CurrentUser() a: AuthUser, @Res() reply: FastifyReply) {
    const reports = await this.teamMonth.buildAll(a, q);
    return this.sendExport(reply, reports, this.exporter.fileName(q.teamId ? 'team' : 'all', reports[0]?.team.name ?? null, q.period, q.format), q.format);
  }
```
(import `TeamMonthReport` type from `./team-month.service`; add `ExportService` to `ReportsModule.providers`.)

Append to `test/reports.e2e.spec.ts`:
```ts
  it('exports xlsx and csv for a team, and all teams for finance', async () => {
    const f = await fixture();
    const x = await app.inject({ method: 'GET', url: `/api/v1/reports/team-month/export?teamId=${f.team.id}&period=2026-09`, headers: bearer(await tok(f.tl)) });
    expect(x.statusCode).toBe(200); expect(x.headers['content-disposition']).toBe('attachment; filename="overtrack-platform-2026-09.xlsx"');
    expect(x.rawPayload.subarray(0, 2).toString()).toBe('PK');
    const c = await app.inject({ method: 'GET', url: `/api/v1/reports/team-month/export?teamId=${f.team.id}&period=2026-09&format=csv`, headers: bearer(await tok(f.tl)) });
    expect(c.body.split('\n')[0]).toContain('Employee code,Employee');
    expect(c.body.trim().split('\n')).toHaveLength(4);
    const fin = await createUser(db, { role: 'finance' });
    const all = await app.inject({ method: 'GET', url: `/api/v1/reports/employees/export?period=2026-09&format=csv`, headers: bearer(await tok(fin)) });
    expect(all.headers['content-disposition']).toContain('overtrack-all-2026-09.csv');
    expect((await app.inject({ method: 'GET', url: `/api/v1/reports/employees/export?period=2026-09`, headers: bearer(await tok(f.a)) })).statusCode).toBe(403);
  });
```

- [ ] **Step 4: Run tests** — `pnpm vitest run src/reports test/reports.e2e.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add xlsx and csv exports for team month and all employees"
```

---

### Task 18: Seed script

**Files:**
- Create: `src/database/seed.ts`
- Create: `test/seed.e2e.spec.ts`

**Interfaces:**
- Produces: `seed(app: INestApplicationContext): Promise<void>` idempotent (skips when an admin exists), plus the CLI entry `pnpm seed`. Seeded logins (all password `Password123!`): `admin@overtrack.local` (admin), `finance@overtrack.local`, `cto@overtrack.local`, per team `tl.<team>@`, `dm.<team>@`, `emp1..3.<team>@` for teams `platform` and `mobile`. Chains TL → DM → CTO. Sheets for last month: platform emp1 draft with entries, emp2 submitted (at TL), emp3 approved; mobile emp1 rejected, emp2 paid, emp3 submitted at CTO.

- [ ] **Step 1: Write the failing test**

`test/seed.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { count, eq } from 'drizzle-orm';
import { createTestApp, login } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seed } from '@/database/seed';
import { DrizzleService } from '@/database/drizzle.service';
import { sheets, users } from '@/database/schema';

describe('seed', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; await truncateAll(db); });
  afterAll(async () => { await app.close(); });

  it('creates the demo dataset once', async () => {
    await seed(app); await seed(app);
    const [{ n }] = await db.select({ n: count() }).from(users); expect(Number(n)).toBe(3 + 2 * 5);
    expect((await login(app, 'admin@overtrack.local', 'Password123!')).accessToken).toBeTypeOf('string');
    const statuses = (await db.select({ s: sheets.status }).from(sheets)).map((r) => r.s).sort();
    expect(statuses).toEqual(['approved', 'draft', 'paid', 'rejected', 'submitted', 'submitted']);
    const [paid] = await db.select().from(sheets).where(eq(sheets.status, 'paid'));
    expect(paid.paymentReference).toBe('DEMO-BATCH-1');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`src/database/seed.ts`:
```ts
import 'dotenv/config';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { count, eq } from 'drizzle-orm';
import { subMonths, format } from 'date-fns';
import { AppModule } from '@/app.module';
import { DrizzleService } from './drizzle.service';
import { users, teams, sheets, sheetEntries, settings, UserRole } from './schema';
import { AuthService } from '@/auth/auth.service';
import { OvertimeTypesService } from '@/overtime-types/overtime-types.service';
import { ApprovalChainsService } from '@/approval-chains/approval-chains.service';
import { WorkflowService } from '@/workflow/workflow.service';
import { SheetsService } from '@/sheets/sheets.service';
import { AuthUser } from '@/common/auth/auth-user';

const PASSWORD = 'Password123!';

export async function seed(app: INestApplicationContext): Promise<void> {
  const db = app.get(DrizzleService).db;
  const [{ n }] = await db.select({ n: count() }).from(users).where(eq(users.role, 'admin'));
  if (Number(n) > 0) return;
  const hash = await AuthService.hashPassword(PASSWORD);
  const mk = async (email: string, firstName: string, lastName: string, role: UserRole, teamId: string | null = null, code?: string) =>
    (await db.insert(users).values({ email, firstName, lastName, role, teamId, passwordHash: hash, employeeCode: code ?? null, timezone: 'Asia/Riyadh' }).returning())[0];

  await db.insert(settings).values({ id: 1, companyName: 'OverTrack Demo', defaultTimezone: 'Asia/Riyadh' }).onConflictDoNothing();
  const types = app.get(OvertimeTypesService); await types.ensureDefaults();
  const [weekday, weekend] = await types.list();

  const adminUser = await mk('admin@overtrack.local', 'Ada', 'Admin', 'admin');
  await mk('finance@overtrack.local', 'Fay', 'Finance', 'finance');
  const cto = await mk('cto@overtrack.local', 'Cem', 'Taylor', 'cto');
  const admin: AuthUser = { id: adminUser.id, role: 'admin', teamId: null };

  const chains = app.get(ApprovalChainsService); const workflow = app.get(WorkflowService); const sheetsSvc = app.get(SheetsService);
  const period = format(subMonths(new Date(), 1), 'yyyy-MM');
  let code = 100;

  for (const slug of ['platform', 'mobile']) {
    const name = slug[0].toUpperCase() + slug.slice(1);
    const [team] = await db.insert(teams).values({ name, description: `${name} team` }).returning();
    const tl = await mk(`tl.${slug}@overtrack.local`, 'Tara', `${name} Lead`, 'tech_lead', team.id, `E${code++}`);
    const dm = await mk(`dm.${slug}@overtrack.local`, 'Dan', `${name} Manager`, 'delivery_manager', null, `E${code++}`);
    await db.update(teams).set({ techLeadId: tl.id }).where(eq(teams.id, team.id));
    await chains.replaceForTeam(adminUser.id, team.id, { steps: [{ label: 'Tech Lead', approverId: tl.id, backupApproverId: dm.id }, { label: 'Delivery Manager', approverId: dm.id }, { label: 'CTO', approverId: cto.id }] });
    const emps = [] as Array<typeof tl>;
    for (let i = 1; i <= 3; i++) emps.push(await mk(`emp${i}.${slug}@overtrack.local`, ['Eve', 'Eli', 'Emma'][i - 1], name, 'employee', team.id, `E${code++}`));

    const addEntries = async (empId: string) => {
      const s = await sheetsSvc.getOrCreateForPeriod(empId, period);
      await db.insert(sheetEntries).values([
        { sheetId: s.id, date: `${period}-03`, startTime: '18:00', endTime: '20:00', hours: '2.00', overtimeTypeId: weekday.id, multiplierSnapshot: weekday.multiplier.toFixed(2), weightedHours: (2 * weekday.multiplier).toFixed(2), workItem: 'OT-101', description: 'Release night support and smoke tests' },
        { sheetId: s.id, date: `${period}-06`, startTime: '10:00', endTime: '14:00', hours: '4.00', overtimeTypeId: weekend.id, multiplierSnapshot: weekend.multiplier.toFixed(2), weightedHours: (4 * weekend.multiplier).toFixed(2), workItem: 'OT-102', description: 'Weekend incident response for customer outage' },
      ]);
      await sheetsSvc.recomputeTotals(db, s.id);
      return s.id;
    };
    const actorOf = (u: typeof tl): AuthUser => ({ id: u.id, role: u.role, teamId: u.teamId });
    const ver = async (id: string) => (await db.select({ v: sheets.version }).from(sheets).where(eq(sheets.id, id)))[0].v;
    const step = async (actor: AuthUser, id: string, action: Parameters<WorkflowService['act']>[2]) => workflow.act(actor, id, action, await ver(id));

    const s1 = await addEntries(emps[0].id);
    const s2 = await addEntries(emps[1].id); await step(actorOf(emps[1]), s2, { type: 'submit', chain: [] });
    const s3 = await addEntries(emps[2].id); await step(actorOf(emps[2]), s3, { type: 'submit', chain: [] });
    if (slug === 'platform') {
      for (const a of [tl, dm, cto]) await step(actorOf(a), s3, { type: 'approve' });
    } else {
      await step(actorOf(tl), s1, { type: 'submit', chain: [] }).catch(() => undefined); // s1 is emp1's; owner must submit
      await step(actorOf(emps[0]), s1, { type: 'submit', chain: [] });
      await step(actorOf(tl), s1, { type: 'reject', reason: 'Please link the incident tickets' });
      for (const a of [tl, dm, cto]) await step(actorOf(a), s2, { type: 'approve' });
      await step(admin, s2, { type: 'markPaid', paymentReference: 'DEMO-BATCH-1' });
      await step(actorOf(tl), s3, { type: 'approve' }); await step(actorOf(dm), s3, { type: 'approve' });
    }
  }
}

if (require.main === module) {
  NestFactory.createApplicationContext(AppModule).then(async (ctx) => { await seed(ctx); await ctx.close(); console.log('seeded'); });
}
```
Remove the `.catch(() => undefined)` line and its comment before committing; it was a reminder that only the owner can submit. The resulting statuses per team: platform → draft, submitted, approved; mobile → rejected, paid, submitted (at CTO).

- [ ] **Step 4: Run tests** → PASS. Then run `pnpm seed` against the dev database (`docker compose up -d`, `pnpm db:migrate`, `pnpm seed`) and log in via Swagger with `admin@overtrack.local`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add idempotent demo seed"
```

---

### Task 19: Dockerfile, production compose, full end-to-end flow test

**Files:**
- Create: `Dockerfile`, `docker-compose.prod.yml`, `.dockerignore`, `test/full-flow.e2e.spec.ts`
- Modify: `README.md` (run instructions)

**Interfaces:**
- Produces: image `over-track-api` exposing port 3000, running migrations on start; `docker-compose.prod.yml` with services `postgres`, `api`, `web` (web image built from `../over-track-web`, nginx proxying `/api` to `api:3000`).

- [ ] **Step 1: Write the full flow test**

`test/full-flow.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seed } from '@/database/seed';
import { DrizzleService } from '@/database/drizzle.service';
import { subMonths, format } from 'date-fns';

describe('full flow on seeded data', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => { app = await createTestApp(); await truncateAll(app.get(DrizzleService).db); await seed(app); });
  afterAll(async () => { await app.close(); });
  const tok = (email: string) => login(app, email, 'Password123!').then((r) => r.accessToken);
  const period = format(subMonths(new Date(), 1), 'yyyy-MM');

  it('employee submits → TL, DM, CTO approve → finance pays → export contains the row', async () => {
    const emp = await tok('emp1.platform@overtrack.local');
    const mine = await app.inject({ method: 'GET', url: `/api/v1/sheets?period=${period}`, headers: bearer(emp) });
    const sheet = mine.json().data[0]; expect(sheet.status).toBe('draft');
    let v = sheet.version;
    const act = async (email: string, action: string, extra: Record<string, unknown> = {}) => {
      const r = await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheet.id}/${action}`, headers: bearer(await tok(email)), payload: { version: v, ...extra } });
      expect(r.statusCode, r.body).toBe(200); v = r.json().data.version; return r.json().data;
    };
    await act('emp1.platform@overtrack.local', 'submit');
    await act('tl.platform@overtrack.local', 'approve');
    await act('dm.platform@overtrack.local', 'approve');
    const approved = await act('cto@overtrack.local', 'approve'); expect(approved.status).toBe('approved');
    const paid = await act('finance@overtrack.local', 'mark-paid', { paymentReference: 'E2E-1' }); expect(paid.status).toBe('paid');
    const csv = await app.inject({ method: 'GET', url: `/api/v1/reports/employees/export?period=${period}&format=csv`, headers: bearer(await tok('finance@overtrack.local')) });
    const line = csv.body.split('\n').find((l) => l.includes('Eve Platform') && l.includes('OT-101'));
    expect(line).toContain('paid');
  });
});
```
Run: `pnpm vitest run test/full-flow.e2e.spec.ts` → PASS.

- [ ] **Step 2: Write Docker files**

`.dockerignore`:
```
node_modules
dist
storage
.env
coverage
```

`Dockerfile`:
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY src/database/migrate.ts ./src/database/migrate.ts
RUN pnpm add -g tsx
EXPOSE 3000
CMD ["sh", "-c", "tsx src/database/migrate.ts && node dist/main.js"]
```

`docker-compose.prod.yml`:
```yaml
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: overtrack, POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}, POSTGRES_DB: overtrack }
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U overtrack"], interval: 5s, retries: 10 }
  api:
    build: .
    depends_on: { postgres: { condition: service_healthy } }
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgres://overtrack:${POSTGRES_PASSWORD}@postgres:5432/overtrack
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET}
      WEB_URL: ${WEB_URL:?set WEB_URL}
      CORS_ORIGIN: ${WEB_URL}
      SMTP_URL: ${SMTP_URL:?set SMTP_URL}
      MAIL_FROM: ${MAIL_FROM:-OverTrack <no-reply@overtrack.local>}
      STORAGE_PATH: /data/storage
      DEFAULT_TIMEZONE: ${DEFAULT_TIMEZONE:-UTC}
    volumes: ["storage:/data/storage"]
  web:
    build: ../over-track-web
    depends_on: [api]
    ports: ["80:80"]
volumes:
  pgdata:
  storage:
```

`README.md`:
```markdown
# over-track-api

## Run locally
docker compose up -d          # postgres + mailhog (http://localhost:8025)
cp .env.example .env
pnpm install && pnpm db:migrate && pnpm seed
pnpm start:dev                # http://localhost:3000/docs

Seeded logins (password `Password123!`): admin@overtrack.local, finance@overtrack.local, cto@overtrack.local,
tl.platform@, dm.platform@, emp1..3.platform@, same for mobile.

## Test
pnpm test                     # needs Docker (Testcontainers)

## Production
POSTGRES_PASSWORD=… JWT_SECRET=… WEB_URL=https://overtrack.example.com SMTP_URL=smtp://… docker compose -f docker-compose.prod.yml up -d --build
```

- [ ] **Step 3: Verify the image builds**

Run: `docker build -t over-track-api .` → exits 0.

- [ ] **Step 4: Run the whole suite and lint**

Run: `pnpm lint && pnpm test` → no lint errors, all specs PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Dockerfile, production compose and full-flow e2e test"
```

---

## Self-review notes

- Spec 2 (roles matrix): Roles guard + service checks in Tasks 4, 5, 9, 13, 16, 17. Finance/admin on mark-paid: Task 13.
- Spec 3 (domain): Task 2 schema; validation in Task 9; attachments Task 10; audit Task 8; notifications Task 15; tokens Task 4; settings Task 2 + reminder Task 15.
- Spec 4.1 (transitions): Task 12 (pure) + Task 13 (tx, lock, version, audit, events, multiplier re-snapshot). 4.2 inbox: Task 14. 4.3 team month: Task 16.
- Spec 5.3 auth: Task 4 + 5 (invite, forgot, rate limit). 5.4 API: every endpoint appears in Tasks 4–17; `GET /sheets/:id/timeline` Task 13; `GET /admin/audit` Task 8; `GET /health` Task 1.
- Spec 5.5 events/notifications and reminder: Task 15. 5.6 exports: Task 17. 5.7 testing: unit (3, 9, 12, 17), integration/e2e (all), seed (18). 5.8 dev + deploy: Tasks 1 and 19.
- Review Focus 1 → Task 9 test "rejects end before start, crossing midnight". 2 → Task 13 "stale version". 3 → Task 4 "rotates… revokes the family on reuse". 4 → Task 13 "keeps the snapshot". 5 → Task 12 "skips steps whose primary approver is the owner; backup-self is ignored" + "auto-approves".
- Type consistency checked: `SheetsService.toSummary`, `entriesOf`, `stepsOf`, `lockForUpdate`, `recomputeTotals`, `findRaw`, `assertCanView` are used by Tasks 13, 14, 16 with the signatures defined in Task 9. `ChainStepInput` is defined in Task 11 and consumed by Task 12/13. `WorkflowEvent.payload` shape is shared by Task 12 and Task 15.
