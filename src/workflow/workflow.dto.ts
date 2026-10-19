import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zUuid } from '@/common/zod';
const version = z.number().int().positive();
export class SubmitDto extends createZodDto(z.object({ version })) {}
export class WithdrawDto extends createZodDto(z.object({ version })) {}
export class ApproveDto extends createZodDto(z.object({ version, comment: z.string().max(500).optional(), overrideReason: z.string().max(500).optional() })) {}
export class RejectDto extends createZodDto(z.object({ version, reason: z.string().max(500), overrideReason: z.string().max(500).optional() })) {}
export class ReasonDto extends createZodDto(z.object({ version, reason: z.string().max(500) })) {}
export class MarkPaidDto extends createZodDto(z.object({ version, paymentReference: z.string().max(60), paidAt: z.string().datetime().optional() })) {}
export class MarkPaidBulkDto extends createZodDto(z.object({ sheets: z.array(z.object({ id: zUuid, version })).min(1).max(200), paymentReference: z.string().min(1).max(60), paidAt: z.string().datetime().optional() })) {}
