import { Module } from '@nestjs/common';
import { SheetsModule } from '@/sheets/sheets.module';
import { ReportsController } from './reports.controller';
import { TeamMonthService } from './team-month.service';
import { ExportService } from './export.service';
@Module({ imports: [SheetsModule], controllers: [ReportsController], providers: [TeamMonthService, ExportService], exports: [TeamMonthService] })
export class ReportsModule {}
