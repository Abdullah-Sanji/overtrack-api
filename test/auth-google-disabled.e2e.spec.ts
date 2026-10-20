import { describe, it, expect, vi } from 'vitest';
import { createTestApp } from './helpers/app';

// Own file: ConfigModule reads env once when AppModule is imported. An empty string pins "unset" even when the
// developer's .env sets a client id (dotenv does not override an existing key; validateEnv maps "" to undefined).
vi.hoisted(() => { process.env.GOOGLE_CLIENT_ID = ''; });

describe('auth/google when GOOGLE_CLIENT_ID is unset', () => {
  it('returns 503 GOOGLE_SIGNIN_DISABLED', async () => {
    const app = await createTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: 'anything-long-enough' } });
    expect(res.statusCode).toBe(503); expect(res.json().code).toBe('GOOGLE_SIGNIN_DISABLED');
    await app.close();
  });
});
