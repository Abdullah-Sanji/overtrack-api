import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zPaginationQuery, zUuid } from '@/common/zod';
export class ListAuditQueryDto extends createZodDto(zPaginationQuery.extend({
  entityType: z.enum(['sheet', 'user', 'team', 'chain', 'overtime_type', 'role']).optional(), entityId: zUuid.optional(), actorId: zUuid.optional(),
  from: z.string().datetime().optional(), to: z.string().datetime().optional(),
})) {}
