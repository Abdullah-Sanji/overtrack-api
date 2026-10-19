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
  // Auth routes are limited to 10/min per IP; give each request without an explicit address its own
  // so multi-login tests don't trip the limiter. Tests that pass remoteAddress still hit a shared bucket.
  const fastify = app.getHttpAdapter().getInstance();
  const inject = fastify.inject.bind(fastify) as (opts: unknown) => unknown;
  let n = 0;
  (fastify as unknown as { inject: unknown }).inject = (opts: unknown) => {
    if (opts && typeof opts === 'object' && !('remoteAddress' in opts)) {
      n++;
      return inject({ ...opts, remoteAddress: `10.1.${(n >> 8) & 255}.${n & 255}` });
    }
    return inject(opts);
  };
  return app;
}

export async function login(app: NestFastifyApplication, email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'ot_refresh')!;
  return { accessToken: res.json().data.accessToken as string, cookie: `${cookie.name}=${cookie.value}` };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
