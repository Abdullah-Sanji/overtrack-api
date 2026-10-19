import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '@/common/auth/roles.decorator';
import { DomainError } from '@/common/errors/domain-error';
import { uniqueViolationConstraint } from '@/common/errors/pg';
import { OvertimeTypesService } from './overtime-types.service';
import { CreateOvertimeTypeDto, ListOvertimeTypesQueryDto, UpdateOvertimeTypeDto } from './overtime-types.dto';

@Controller('overtime-types')
export class OvertimeTypesController {
  constructor(private readonly types: OvertimeTypesService) {}
  @Get() async list(@Query() q: ListOvertimeTypesQueryDto) { return { data: await this.types.list(q.includeInactive ?? false) }; }
  @Post() @Roles('admin')
  async create(@Body() dto: CreateOvertimeTypeDto) {
    try {
      return { data: await this.types.create(dto) };
    } catch (err) {
      if (uniqueViolationConstraint(err) === 'overtime_types_name_unique') throw new DomainError('CONFLICT', 'Overtime type name already exists', 409);
      throw err;
    }
  }
  @Patch(':id') @Roles('admin') async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOvertimeTypeDto) { return { data: await this.types.update(id, dto) }; }
}
