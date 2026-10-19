import { Module } from '@nestjs/common';
import { SheetsModule } from '@/sheets/sheets.module';
import { ReportsController } from './reports.controller';
import { TeamMonthService } from './team-month.service';
@Module({ imports: [SheetsModule], controllers: [ReportsController], providers: [TeamMonthService], exports: [TeamMonthService] })
export class ReportsModule {}
