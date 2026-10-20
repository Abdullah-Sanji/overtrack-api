import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { inArray } from 'drizzle-orm';
import { AppModule } from '@/app.module';
import { Env } from '@/common/config/env';
import { RolesService } from '@/roles/roles.service';
import { DrizzleService } from './drizzle.service';
import { users } from './schema';
import { readFirstSheet } from './xlsx-reader';

export interface ImportOptions { adminEmail: string; dryRun?: boolean }
/** Emails created / skipped; problems are human-readable lines prefixed `row N:` (sheet row, header is 1) or `file:`. */
export interface ImportReport { created: string[]; skipped: string[]; problems: string[] }

const REQUIRED = ['EmployeeNumber', 'FullName', 'WorkEmail', 'Department'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Candidate { rowNo: number; email: string; firstName: string; lastName: string; employeeCode: string; department: string | null }

/**
 * Validates every row first; writes nothing when any problem exists. Existing emails are skipped
 * untouched. Imported users get no password and no invite: they sign in with Google.
 */
export async function importEmployees(app: INestApplicationContext, rows: Record<string, string>[], opts: ImportOptions): Promise<ImportReport> {
  const report: ImportReport = { created: [], skipped: [], problems: [] };
  const adminEmail = opts.adminEmail.trim().toLowerCase();

  const keys = Object.keys(rows[0] ?? {});
  const colOf = (name: string) => keys.find((k) => k.toLowerCase() === name.toLowerCase());
  const missing = REQUIRED.filter((c) => !colOf(c));
  if (missing.length) { report.problems.push(`file: missing column(s) ${missing.join(', ')}`); return report; }
  const col = Object.fromEntries(REQUIRED.map((c) => [c, colOf(c)!])) as Record<(typeof REQUIRED)[number], string>;

  const candidates: Candidate[] = [];
  const seenEmail = new Map<string, number>(); const seenCode = new Map<string, number>();
  rows.forEach((r, i) => {
    const rowNo = i + 2;
    const email = (r[col.WorkEmail] ?? '').trim().toLowerCase();
    const words = (r[col.FullName] ?? '').trim().split(/\s+/).filter(Boolean);
    const employeeCode = (r[col.EmployeeNumber] ?? '').trim();
    const department = (r[col.Department] ?? '').trim() || null;
    const problem = seenEmail.has(email) ? `duplicate email ${email} (also row ${seenEmail.get(email)})`
      : seenCode.has(employeeCode) ? `duplicate employee code ${employeeCode} (also row ${seenCode.get(employeeCode)})`
      : words.length < 2 ? 'name must have at least two words'
      : !EMAIL_RE.test(email) ? `invalid email ${email}`
      : employeeCode.length > 20 ? 'employee code longer than 20 characters'
      : department && department.length > 60 ? 'department longer than 60 characters'
      : null;
    if (problem) { report.problems.push(`row ${rowNo}: ${problem}`); return; }
    seenEmail.set(email, rowNo); if (employeeCode) seenCode.set(employeeCode, rowNo);
    candidates.push({ rowNo, email, firstName: words[0], lastName: words.slice(1).join(' '), employeeCode, department });
  });
  if (!seenEmail.has(adminEmail) && !report.problems.some((p) => p.includes(`email ${adminEmail}`))) report.problems.push(`file: admin email ${adminEmail} not found in the sheet`);

  const db = app.get(DrizzleService).db;
  const existing = candidates.length ? await db.select({ email: users.email, employeeCode: users.employeeCode }).from(users).where(inArray(users.email, candidates.map((c) => c.email))) : [];
  const existingEmails = new Set(existing.map((e) => e.email));
  const toCreate = candidates.filter((c) => !existingEmails.has(c.email));
  report.skipped = candidates.filter((c) => existingEmails.has(c.email)).map((c) => c.email);
  const codes = toCreate.map((c) => c.employeeCode).filter(Boolean);
  const taken = codes.length ? await db.select({ email: users.email, employeeCode: users.employeeCode }).from(users).where(inArray(users.employeeCode, codes)) : [];
  for (const c of toCreate) {
    const owner = taken.find((t) => t.employeeCode === c.employeeCode);
    if (owner) report.problems.push(`row ${c.rowNo}: employee code ${c.employeeCode} already belongs to ${owner.email}`);
  }
  if (report.problems.length) return report;

  report.created = toCreate.map((c) => c.email);
  if (opts.dryRun || !toCreate.length) return report;

  const roleIds = await app.get(RolesService).ensureSystemRoles();
  const timezone = app.get(ConfigService<Env, true>).get('DEFAULT_TIMEZONE');
  await db.transaction(async (tx) => {
    await tx.insert(users).values(toCreate.map((c) => ({
      email: c.email, firstName: c.firstName, lastName: c.lastName, employeeCode: c.employeeCode || null, department: c.department,
      roleId: roleIds.get(c.email === adminEmail ? 'admin' : 'employee')!, teamId: null, passwordHash: null, timezone, isActive: true,
    })));
  });
  return report;
}

function parseArgs(argv: string[]): { file?: string; adminEmail?: string; dryRun: boolean } {
  const out: { file?: string; adminEmail?: string; dryRun: boolean } = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--admin') out.adminEmail = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else if (!argv[i].startsWith('--')) out.file = argv[i];
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || !args.adminEmail) {
    console.error('usage: import-employees <file.xlsx> --admin <email> [--dry-run]');
    process.exit(2);
  }
  let rows: Record<string, string>[];
  try {
    rows = readFirstSheet(new Uint8Array(readFileSync(args.file)));
  } catch (err) {
    console.error(`cannot read ${args.file}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
    .then(async (ctx) => {
      try {
        const r = await importEmployees(ctx, rows, { adminEmail: args.adminEmail!, dryRun: args.dryRun });
        for (const p of r.problems) console.error(p);
        if (r.problems.length) { console.error(`${r.problems.length} problem(s); nothing was written`); process.exitCode = 1; return; }
        console.log(`${args.dryRun ? '[dry run] would create' : 'created'} ${r.created.length}, skipped ${r.skipped.length} (already existed)`);
        for (const s of r.skipped) console.log(`skipped ${s}`);
      } finally {
        await ctx.close();
      }
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
