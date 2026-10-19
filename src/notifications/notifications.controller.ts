import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { parsePagination } from '@/common/pagination';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './notifications.dto';

@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get() list(@Query() q: ListNotificationsQueryDto, @CurrentUser() u: AuthUser) { return this.notifications.listFor(u.id, q.unreadOnly ?? false, parsePagination(q)); }
  @Post('read-all') @HttpCode(204) async readAll(@CurrentUser() u: AuthUser) { await this.notifications.markAllRead(u.id); }
  @Post(':id/read') @HttpCode(204) async read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { await this.notifications.markRead(u.id, id); }
}
