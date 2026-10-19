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
