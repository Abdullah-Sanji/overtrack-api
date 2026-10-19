import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { sheetStatusEnum } from '@/database/schema';
import { zPaginationQuery, zPeriod, zUuid } from '@/common/zod';
import { hoursBetween, isQuarterStep } from './hours';

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const zHours = z.number().min(0.25).max(16).refine(isQuarterStep, 'Hours must be in 0.25 steps');

const entryBase = z.object({
  date: zDate, startTime: zTime, endTime: zTime, hours: zHours.optional(), overtimeTypeId: zUuid,
  workItem: z.string().min(1).max(120), workItemUrl: z.string().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) URL').nullable().optional(),
  description: z.string().min(10).max(1000), requestedById: zUuid.nullable().optional(),
});
const timeOrder = (v: { startTime: string; endTime: string }) => hoursBetween(v.startTime, v.endTime) > 0;

export class CreateEntryDto extends createZodDto(entryBase.refine(timeOrder, { message: 'End time must be after start time on the same day', path: ['endTime'] })) {}
export class UpdateEntryDto extends createZodDto(entryBase.partial()) {}
export class ForPeriodDto extends createZodDto(z.object({ period: zPeriod })) {}
export class ListSheetsQueryDto extends createZodDto(zPaginationQuery.extend({
  employeeId: zUuid.optional(), teamId: zUuid.optional(), period: zPeriod.optional(), status: z.enum(sheetStatusEnum.enumValues).optional(),
})) {}
