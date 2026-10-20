import 'dotenv/config';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AppModule } from '@/app.module';
import { AuthService } from '@/auth/auth.service';
import { DrizzleService } from './drizzle.service';
import { users, LEGACY_ROLE_NAMES } from './schema';
import { RolesService } from '@/roles/roles.service';

export interface CreateAdminInput { email: string; password: string; firstName: string; lastName: string }

const inputSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(10, 'ADMIN_PASSWORD must be at least 10 characters'),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

export async function createAdmin(app: INestApplicationContext, input: CreateAdminInput): Promise<'created' | 'exists'> {
  const data = inputSchema.parse(input);
  const db = app.get(DrizzleService).db;
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email));
  if (existing) return 'exists';
  const roleIds = await app.get(RolesService).ensureSystemRoles();
  const passwordHash = await AuthService.hashPassword(data.password);
  await db.insert(users).values({ email: data.email, firstName: data.firstName, lastName: data.lastName, role: 'admin', roleId: roleIds.get(LEGACY_ROLE_NAMES.admin)!, isActive: true, passwordHash });
  return 'created';
}

if (require.main === module) {
  const env = process.env;
  const parsed = inputSchema.safeParse({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, firstName: env.ADMIN_FIRST_NAME, lastName: env.ADMIN_LAST_NAME });
  if (!parsed.success) {
    console.error(`Invalid admin env (ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FIRST_NAME, ADMIN_LAST_NAME):\n${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')}`);
    process.exit(1);
  }
  NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
    .then(async (ctx) => {
      const result = await createAdmin(ctx, parsed.data);
      await ctx.close();
      console.log(`admin ${result}: ${parsed.data.email}`);
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
