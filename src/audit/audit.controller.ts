import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '@/common/auth/roles.decorator';
import { AuditService } from './audit.service';
import { ListAuditQueryDto } from './audit.dto';

@Controller('admin/audit')
@Roles('admin')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get() list(@Query() q: ListAuditQueryDto) { return this.audit.list(q); }
}
