import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
const zHex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export class CreateOvertimeTypeDto extends createZodDto(z.object({ name: z.string().min(1).max(60), multiplier: z.number().gt(0).max(99.99), color: zHex.optional(), sortOrder: z.number().int().optional() })) {}
export class UpdateOvertimeTypeDto extends createZodDto(z.object({ name: z.string().min(1).max(60).optional(), multiplier: z.number().gt(0).max(99.99).optional(), color: zHex.optional(), sortOrder: z.number().int().optional(), isActive: z.boolean().optional() })) {}
export class ListOvertimeTypesQueryDto extends createZodDto(z.object({ includeInactive: z.enum(['true', 'false']).transform((v) => v === 'true').optional() })) {}
