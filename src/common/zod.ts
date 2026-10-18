import { z } from 'zod';

export const zUuid = z.string().uuid();
export const zPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
export const zPaginationQuery = z.object({
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
  sort: z.string().regex(/^[a-zA-Z]+:(asc|desc)$/).optional(),
});
export const periodToDate = (period: string) => `${period}-01`;
export const dateToPeriod = (date: string) => date.slice(0, 7);
