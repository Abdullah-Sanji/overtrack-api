import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { Levels } from '@/common/auth/levels.decorator';
import { OvertimeTypesService } from './overtime-types.service';
import { CreateOvertimeTypeDto, ListOvertimeTypesQueryDto, UpdateOvertimeTypeDto } from './overtime-types.dto';

@Controller('overtime-types')
export class OvertimeTypesController {
  constructor(private readonly types: OvertimeTypesService) {}
  @Get() async list(@Query() q: ListOvertimeTypesQueryDto) { return { data: await this.types.list(q.includeInactive ?? false) }; }
  @Post() @Levels('admin') async create(@CurrentUser() actor: AuthUser, @Body() dto: CreateOvertimeTypeDto) { return { data: await this.types.create(actor.id, dto) }; }
  @Patch(':id') @Levels('admin') async update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOvertimeTypeDto) { return { data: await this.types.update(actor.id, id, dto) }; }
}
