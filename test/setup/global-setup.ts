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
