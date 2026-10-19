import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { sheetStatusEnum } from '@/database/schema';
import { zPeriod, zUuid } from '@/common/zod';
const status = z.enum(sheetStatusEnum.enumValues).optional();
export class TeamMonthQueryDto extends createZodDto(z.object({ teamId: zUuid, period: zPeriod, status })) {}
export class TeamMonthExportQueryDto extends createZodDto(z.object({ teamId: zUuid, period: zPeriod, status, format: z.enum(['xlsx', 'csv']).default('xlsx') })) {}
export class EmployeesExportQueryDto extends createZodDto(z.object({ period: zPeriod, teamId: zUuid.optional(), status, format: z.enum(['xlsx', 'csv']).default('xlsx') })) {}
