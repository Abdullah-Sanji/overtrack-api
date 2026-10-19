import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zPaginationQuery, zUuid } from '@/common/zod';

export class CreateTeamDto extends createZodDto(z.object({ name: z.string().min(1).max(80), description: z.string().max(500).nullable().optional(), techLeadId: zUuid.nullable().optional() })) {}
export class UpdateTeamDto extends createZodDto(z.object({ name: z.string().min(1).max(80).optional(), description: z.string().max(500).nullable().optional(), techLeadId: zUuid.nullable().optional(), isActive: z.boolean().optional() })) {}
export class ListTeamsQueryDto extends createZodDto(zPaginationQuery.extend({ search: z.string().optional(), isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional() })) {}
