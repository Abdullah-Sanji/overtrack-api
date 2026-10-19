import { Controller, Get, Query, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser, MANAGER_ROLES } from '@/common/auth/auth-user';
import { Roles } from '@/common/auth/roles.decorator';
import { TeamMonthReport, TeamMonthService } from './team-month.service';
import { ExportService } from './export.service';
import { EmployeesExportQueryDto, TeamMonthExportQueryDto, TeamMonthQueryDto } from './reports.dto';

@Controller('reports')
export class ReportsController {
  constructor(private readonly teamMonth: TeamMonthService, private readonly exporter: ExportService) {}
  @Get('team-month') async teamMonthReport(@Query() q: TeamMonthQueryDto, @CurrentUser() a: AuthUser) { return { data: await this.teamMonth.build(a, q) }; }

  private async sendExport(reply: FastifyReply, reports: TeamMonthReport[], name: string, format: 'xlsx' | 'csv') {
    const body = format === 'xlsx' ? await this.exporter.toXlsx(reports) : this.exporter.toCsv(reports);
    reply.header('content-type', format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${name}"`);
    return reply.send(body);
  }

  @Get('team-month/export') @Roles(...MANAGER_ROLES)
  async exportTeam(@Query() q: TeamMonthExportQueryDto, @CurrentUser() a: AuthUser, @Res() reply: FastifyReply) {
    const report = await this.teamMonth.build(a, q);
    return this.sendExport(reply, [report], this.exporter.fileName('team', report.team.name, q.period, q.format), q.format);
  }

  @Get('employees/export') @Roles(...MANAGER_ROLES)
  async exportAll(@Query() q: EmployeesExportQueryDto, @CurrentUser() a: AuthUser, @Res() reply: FastifyReply) {
    const reports = await this.teamMonth.buildAll(a, q);
    return this.sendExport(reply, reports, this.exporter.fileName(q.teamId ? 'team' : 'all', reports[0]?.team.name ?? null, q.period, q.format), q.format);
  }
}
