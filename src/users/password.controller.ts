import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public } from '@/common/auth/public.decorator';
import { ForgotPasswordDto } from '@/auth/auth.dto';
import { UsersService } from './users.service';

@Controller('auth')
export class PasswordController {
  constructor(private readonly users: UsersService) {}
  @Public() @Post('forgot-password') @HttpCode(204)
  async forgot(@Body() dto: ForgotPasswordDto) { await this.users.forgotPassword(dto.email); }
}
