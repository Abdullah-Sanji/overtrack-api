import { Module } from '@nestjs/common';
import { OvertimeTypesModule } from '@/overtime-types/overtime-types.module';
import { SheetsController } from './sheets.controller';
import { SheetsService } from './sheets.service';
import { EntriesService } from './entries.service';
import { VisibilityService } from './visibility.service';
@Module({ imports: [OvertimeTypesModule], controllers: [SheetsController], providers: [SheetsService, EntriesService, VisibilityService], exports: [SheetsService, VisibilityService] })
export class SheetsModule {}
