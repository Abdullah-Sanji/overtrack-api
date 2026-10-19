import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zPaginationQuery } from '@/common/zod';
export class ListNotificationsQueryDto extends createZodDto(zPaginationQuery.extend({ unreadOnly: z.enum(['true', 'false']).transform((v) => v === 'true').optional() })) {}
