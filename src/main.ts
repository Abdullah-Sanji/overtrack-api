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
  await app.listen({ port: config.get('PORT'), host: '0.0.0.0' });
}

if (require.main === module) {
  bootstrap();
}
