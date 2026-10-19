import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { UsersService } from './users.service';
import { ChangePasswordDto, UpdateMeDto } from './users.dto';

@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}
  @Get() async me(@CurrentUser() u: AuthUser) { return { data: await this.users.findById(u.id) }; }
  @Patch() async update(@CurrentUser() u: AuthUser, @Body() dto: UpdateMeDto) { return { data: await this.users.updateMe(u.id, dto) }; }
  @Post('change-password') @HttpCode(204) async changePassword(@CurrentUser() u: AuthUser, @Body() dto: ChangePasswordDto) { await this.users.changePassword(u.id, dto.currentPassword, dto.newPassword); }
}
