import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zPaginationQuery } from '@/common/zod';
export class InboxQueryDto extends createZodDto(zPaginationQuery.extend({ scope: z.enum(['waiting', 'upcoming', 'decided']).default('waiting') })) {}
