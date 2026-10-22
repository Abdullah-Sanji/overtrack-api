import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { AppModule } from './app.module';
import { Env, parseTrustProxy } from './common/config/env';
import { DomainError } from './common/errors/domain-error';

export async function configureApp(app: NestFastifyApplication): Promise<void> {
  // Must come first so the hook exists before Nest registers routes. It must be added before
  // the plugin registers so it mutates route.config before the plugin's own onRoute hook reads it.
  // Only credential- and token-guessing routes are limited. refresh and logout are deliberately
  // exempt: every tab calls them on load, and behind office NAT the per-IP bucket is shared by the
  // whole company, so limiting them locks people out at 9am. Refresh is already protected by
  // rotation plus reuse detection, which makes guessing a 48-byte token pointless.
  const limited = new Set(['login', 'google', 'forgot-password', 'reset-password', 'accept-invite'].map((r) => `/api/v1/auth/${r}`));
  app.getHttpAdapter().getInstance().addHook('onRoute', (route) => {
    if (limited.has(route.url)) route.config = { ...(route.config ?? {}), rateLimit: { max: 10, timeWindow: '1 minute' } };
  });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new DomainError('RATE_LIMITED', 'Too many requests, try again later', 429),
  });
  const config = app.get(ConfigService<Env, true>);
  app.setGlobalPrefix('api/v1');
  // @fastify/cors defaults to GET,HEAD,POST, which blocks PUT/PATCH/DELETE preflights, so list methods explicitly.
  app.enableCors({
    origin: config.get('CORS_ORIGIN').split(','),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  // The API only serves JSON, so in production nothing may load or frame it. Outside production
  // Swagger UI is mounted and needs inline scripts, so the policy is left off there.
  const production = config.get('NODE_ENV') === 'production';
  await app.register(helmet, {
    contentSecurityPolicy: production ? { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } : false,
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  if (config.get('NODE_ENV') !== 'production') {
    const doc = new DocumentBuilder().setTitle('OverTrack API').setVersion('1').addBearerAuth().build();
    const document = SwaggerModule.createDocument(app, doc);
    SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document), { jsonDocumentUrl: 'docs-json' });
  }
}

async function bootstrap() {
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY ?? 'false');
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: true, trustProxy }));
  await configureApp(app);
  const config = app.get(ConfigService<Env, true>);
  await app.listen({ port: config.get('PORT'), host: '0.0.0.0' });
}

if (require.main === module) {
  bootstrap();
}
