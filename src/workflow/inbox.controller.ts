import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { parsePagination } from '@/common/pagination';
import { InboxService } from './inbox.service';
import { InboxQueryDto } from './inbox.dto';

@Controller('approvals/inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}
  @Get() list(@Query() q: InboxQueryDto, @CurrentUser() actor: AuthUser) { return this.inbox.list(actor, q.scope, parsePagination(q)); }
}
