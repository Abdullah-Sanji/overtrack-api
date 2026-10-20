import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations } from '@/database/migrate';

const DRIZZLE = path.resolve(__dirname, '../drizzle');

/** Copies the migrations folder with only the first `n` journal entries. */
function partialMigrations(n: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-mig-'));
  fs.mkdirSync(path.join(dir, 'meta'));
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, n);
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries)
    fs.copyFileSync(path.join(DRIZZLE, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}

describe('migration 0002_roles', () => {
  it('backfills role_id from the old enum for every user', async () => {
    const base = new URL(process.env.DATABASE_URL!);
    const admin = new Pool({ connectionString: base.toString() });
    await admin.query('DROP DATABASE IF EXISTS mig_check');
    await admin.query('CREATE DATABASE mig_check');
    await admin.end();
    const url = new URL(base.toString());
    url.pathname = '/mig_check';

    await runMigrations(url.toString(), partialMigrations(2));
    const pool = new Pool({ connectionString: url.toString() });
    const legacy = ['employee', 'tech_lead', 'delivery_manager', 'cto', 'finance', 'admin'];
    for (const r of legacy)
      await pool.query(
        `INSERT INTO users (first_name, last_name, email, role) VALUES ('A', 'B', '${r}@m.local', '${r}')`,
      );
    await pool.end();

    await runMigrations(url.toString());
    const after = new Pool({ connectionString: url.toString() });
    const { rows } = await after.query(
      `SELECT u.email, r.name, r.level, r.is_system FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.email`,
    );
    await after.end();
    expect(rows).toEqual([
      { email: 'admin@m.local', name: 'Admin', level: 'admin', is_system: true },
      { email: 'cto@m.local', name: 'CTO', level: 'manager', is_system: true },
      { email: 'delivery_manager@m.local', name: 'Delivery Manager', level: 'manager', is_system: true },
      { email: 'employee@m.local', name: 'Employee', level: 'employee', is_system: true },
      { email: 'finance@m.local', name: 'Finance', level: 'finance', is_system: true },
      { email: 'tech_lead@m.local', name: 'Tech Lead', level: 'manager', is_system: true },
    ]);
  });
});
