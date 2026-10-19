import { Controller, Get, Query } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class DirectoryController {
  constructor(private readonly users: UsersService) {}
  @Get('directory') async directory(@Query('search') search?: string) { return { data: await this.users.directory(search || undefined) }; }
}
