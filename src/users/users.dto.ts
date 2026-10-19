import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { userRoleEnum } from '@/database/schema';
import { zPaginationQuery, zUuid } from '@/common/zod';
import { zPassword } from '@/auth/auth.dto';

const zRole = z.enum(userRoleEnum.enumValues);
export class CreateUserDto extends createZodDto(z.object({
  firstName: z.string().min(1).max(60), lastName: z.string().min(1).max(60), email: z.string().email(),
  role: zRole, teamId: zUuid.nullable().optional(), employeeCode: z.string().max(20).nullable().optional(), timezone: z.string().max(64).optional(),
})) {}
export class UpdateUserDto extends createZodDto(z.object({
  firstName: z.string().min(1).max(60).optional(), lastName: z.string().min(1).max(60).optional(), role: zRole.optional(),
  teamId: zUuid.nullable().optional(), employeeCode: z.string().max(20).nullable().optional(), timezone: z.string().max(64).optional(),
})) {}
export class ListUsersQueryDto extends createZodDto(zPaginationQuery.extend({
  search: z.string().optional(), role: zRole.optional(), teamId: zUuid.optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
})) {}
export class UpdateMeDto extends createZodDto(z.object({ firstName: z.string().min(1).max(60).optional(), lastName: z.string().min(1).max(60).optional(), timezone: z.string().max(64).optional() })) {}
export class ChangePasswordDto extends createZodDto(z.object({ currentPassword: z.string().min(1), newPassword: zPassword })) {}
