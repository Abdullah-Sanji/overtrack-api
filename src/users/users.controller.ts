import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { Roles } from '@/common/auth/roles.decorator';
import { UsersService } from './users.service';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './users.dto';

@Controller('users')
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get() list(@Query() q: ListUsersQueryDto) { return this.users.list(q); }
  @Post() async create(@CurrentUser() actor: AuthUser, @Body() dto: CreateUserDto) { return { data: await this.users.create(actor.id, dto) }; }
  @Get(':id') async get(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.users.findById(id) }; }
  @Patch(':id') async update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) { return { data: await this.users.update(actor.id, id, dto) }; }
  @Post(':id/deactivate') @HttpCode(200) async deactivate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return { data: await this.users.setActive(actor.id, id, false) }; }
  @Post(':id/reactivate') @HttpCode(200) async reactivate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return { data: await this.users.setActive(actor.id, id, true) }; }
  @Post(':id/resend-invite') @HttpCode(204) async resend(@Param('id', ParseUUIDPipe) id: string) { await this.users.resendInvite(id); }
}
