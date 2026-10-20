import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const zPassword = z.string().min(10, 'Password must be at least 10 characters').max(128);
export class LoginDto extends createZodDto(z.object({ email: z.string().email(), password: z.string().min(1) })) {}
export class GoogleLoginDto extends createZodDto(z.object({ credential: z.string().min(10) })) {}
export class AcceptInviteDto extends createZodDto(z.object({ token: z.string().min(10), password: zPassword })) {}
export class ForgotPasswordDto extends createZodDto(z.object({ email: z.string().email() })) {}
export class ResetPasswordDto extends createZodDto(z.object({ token: z.string().min(10), password: zPassword })) {}
