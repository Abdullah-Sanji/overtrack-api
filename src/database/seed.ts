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
      await step(actorOf(emps[0]), s1, { type: 'submit', chain: [] });
      await step(actorOf(tl), s1, { type: 'reject', reason: 'Please link the incident tickets' });
      for (const a of [tl, dm, cto]) await step(actorOf(a), s2, { type: 'approve' });
      await step(admin, s2, { type: 'markPaid', paymentReference: 'DEMO-BATCH-1' });
      await step(actorOf(tl), s3, { type: 'approve' }); await step(actorOf(dm), s3, { type: 'approve' });
    }
  }
}

if (require.main === module) {
  NestFactory.createApplicationContext(AppModule).then(async (ctx) => {
    await seed(ctx);
    await new Promise((resolve) => setTimeout(resolve, 100)); // let async notification listeners finish
    await ctx.close();
    console.log('seeded');
  });
}
