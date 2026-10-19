import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '@/common/auth/roles.decorator';
import { UsersService } from './users.service';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './users.dto';

@Controller('users')
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get() list(@Query() q: ListUsersQueryDto) { return this.users.list(q); }
  @Post() async create(@Body() dto: CreateUserDto) { return { data: await this.users.create(dto) }; }
  @Get(':id') async get(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.users.findById(id) }; }
  @Patch(':id') async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) { return { data: await this.users.update(id, dto) }; }
  @Post(':id/deactivate') @HttpCode(200) async deactivate(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.users.setActive(id, false) }; }
  @Post(':id/reactivate') @HttpCode(200) async reactivate(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.users.setActive(id, true) }; }
  @Post(':id/resend-invite') @HttpCode(204) async resend(@Param('id', ParseUUIDPipe) id: string) { await this.users.resendInvite(id); }
}
