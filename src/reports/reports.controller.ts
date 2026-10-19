import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { TeamMonthService } from './team-month.service';
import { TeamMonthQueryDto } from './reports.dto';

@Controller('reports')
export class ReportsController {
  constructor(private readonly teamMonth: TeamMonthService) {}
  @Get('team-month') async teamMonthReport(@Query() q: TeamMonthQueryDto, @CurrentUser() a: AuthUser) { return { data: await this.teamMonth.build(a, q) }; }
}
