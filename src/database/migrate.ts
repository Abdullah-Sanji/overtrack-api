import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'node:path';

export async function runMigrations(databaseUrl: string, migrationsFolder = path.resolve(__dirname, '../../drizzle')): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations(process.env.DATABASE_URL!).then(() => console.log('migrations applied'));
}
