# over-track-api

NestJS (Fastify) + Drizzle + PostgreSQL backend for overtime management.

## Run locally
```
docker compose up -d          # postgres + mailhog (http://localhost:8025)
cp .env.example .env
pnpm install && pnpm db:migrate && pnpm seed
pnpm start:dev                # http://localhost:3000/docs
```

Seeded logins (password `Password123!`): `admin@overtrack.local`, `finance@overtrack.local`, `cto@overtrack.local`,
`tl.platform@overtrack.local`, `dm.platform@overtrack.local`, `emp1.platform@overtrack.local` ... `emp3.platform@overtrack.local`,
and the same pattern for `mobile` (`tl.mobile@`, `dm.mobile@`, `emp1.mobile@` ... `emp3.mobile@`).

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
