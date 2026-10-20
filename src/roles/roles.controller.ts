import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { Levels } from '@/common/auth/levels.decorator';
import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRoleDto } from './roles.dto';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}
  @Get() async list() { return { data: await this.roles.list() }; }
  @Post() @Levels('admin') async create(@CurrentUser() actor: AuthUser, @Body() dto: CreateRoleDto) { return { data: await this.roles.create(actor.id, dto) }; }
  @Patch(':id') @Levels('admin') async update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) { return { data: await this.roles.update(actor.id, id, dto) }; }
  @Delete(':id') @Levels('admin') @HttpCode(204) async remove(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) { await this.roles.remove(actor.id, id); }
}
