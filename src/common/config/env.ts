import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  WEB_URL: z.string().url(),
  CORS_ORIGIN: z.string().min(1),
  SMTP_URL: z.string().min(1),
  MAIL_FROM: z.string().min(1),
  STORAGE_PATH: z.string().min(1).default('./storage'),
  TRUST_PROXY: z.string().default('false'),
  DEFAULT_TIMEZONE: z.string().min(1).default('UTC'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return result.data;
}

/** 'true' | 'false' | hop count, as accepted by Fastify's trustProxy option. */
export function parseTrustProxy(raw: string): boolean | number {
  const v = raw.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false' || v === '') return false;
  if (/^\d+$/.test(v)) return Number(v);
  throw new Error(`Invalid TRUST_PROXY: ${raw}`);
}
