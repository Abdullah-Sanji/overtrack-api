import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zPaginationQuery, zUuid } from '@/common/zod';
import { zPassword } from '@/auth/auth.dto';

// Empty string clears the field; an absent field stays undefined so PATCH without it does not clear it.
const zDepartment = z.string().trim().max(60).nullable().optional().transform((v) => (v === '' ? null : v));

export class CreateUserDto extends createZodDto(z.object({
  firstName: z.string().min(1).max(60), lastName: z.string().min(1).max(60), email: z.string().email(),
  roleId: zUuid, teamId: zUuid.nullable().optional(), employeeCode: z.string().max(20).nullable().optional(), timezone: z.string().max(64).optional(),
  department: zDepartment,
})) {}
export class UpdateUserDto extends createZodDto(z.object({
  firstName: z.string().min(1).max(60).optional(), lastName: z.string().min(1).max(60).optional(), roleId: zUuid.optional(),
  teamId: zUuid.nullable().optional(), employeeCode: z.string().max(20).nullable().optional(), timezone: z.string().max(64).optional(),
  department: zDepartment,
})) {}
export class ListUsersQueryDto extends createZodDto(zPaginationQuery.extend({
  search: z.string().optional(), roleId: zUuid.optional(), teamId: zUuid.optional(), department: z.string().trim().min(1).optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
})) {}
export class UpdateMeDto extends createZodDto(z.object({ firstName: z.string().min(1).max(60).optional(), lastName: z.string().min(1).max(60).optional(), timezone: z.string().max(64).optional() })) {}
export class ChangePasswordDto extends createZodDto(z.object({ currentPassword: z.string().min(1), newPassword: zPassword })) {}
