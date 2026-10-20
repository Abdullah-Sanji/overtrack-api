import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ROLE_LEVELS } from '@/database/schema';

const zName = z.string().trim().min(2).max(40);
const zLevel = z.enum(ROLE_LEVELS);
export class CreateRoleDto extends createZodDto(z.object({ name: zName, level: zLevel })) {}
export class UpdateRoleDto extends createZodDto(z.object({ name: zName.optional(), level: zLevel.optional() })) {}
