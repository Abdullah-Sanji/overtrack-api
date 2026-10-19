import { Module } from '@nestjs/common';
import { OvertimeTypesModule } from '@/overtime-types/overtime-types.module';
import { BootstrapService } from './bootstrap.service';

@Module({ imports: [OvertimeTypesModule], providers: [BootstrapService] })
export class BootstrapModule {}
