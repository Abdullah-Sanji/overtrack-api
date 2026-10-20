import { Module } from '@nestjs/common';
import { OvertimeTypesModule } from '@/overtime-types/overtime-types.module';
import { RolesModule } from '@/roles/roles.module';
import { BootstrapService } from './bootstrap.service';

@Module({ imports: [RolesModule, OvertimeTypesModule], providers: [BootstrapService] })
export class BootstrapModule {}
