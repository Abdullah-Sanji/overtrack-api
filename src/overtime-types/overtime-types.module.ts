import { Module } from '@nestjs/common';
import { OvertimeTypesService } from './overtime-types.service';
import { OvertimeTypesController } from './overtime-types.controller';
@Module({ controllers: [OvertimeTypesController], providers: [OvertimeTypesService], exports: [OvertimeTypesService] })
export class OvertimeTypesModule {}
