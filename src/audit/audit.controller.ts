import { Controller, Get, Query } from '@nestjs/common';
import { Levels } from '@/common/auth/levels.decorator';
import { AuditService } from './audit.service';
import { ListAuditQueryDto } from './audit.dto';

@Controller('admin/audit')
@Levels('admin')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get() list(@Query() q: ListAuditQueryDto) { return this.audit.list(q); }
}
