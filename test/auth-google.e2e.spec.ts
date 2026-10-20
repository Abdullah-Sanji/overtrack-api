import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';
import { DomainError } from '@/common/errors/domain-error';
import { GoogleTokenVerifier, GoogleIdentity } from '@/auth/google-token.verifier';

const identities = new Map<string, GoogleIdentity>(); // credential -> identity
const stub = { verify: async (c: string) => { const id = identities.get(c); if (!id) throw new DomainError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed, try again', 401); return id; } };
const google = (app: NestFastifyApplication, credential: string) => app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential } });

describe('auth/google', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db'];
  beforeAll(async () => { process.env.GOOGLE_CLIENT_ID = 'test-client-id'; app = await createTestApp((b) => b.overrideProvider(GoogleTokenVerifier).useValue(stub)); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); delete process.env.GOOGLE_CLIENT_ID; });
  beforeEach(async () => { await truncateAll(db); identities.clear(); });

  it('signs in a known, active user and sets the refresh cookie', async () => {
    const u = await createUser(db, { email: 'g@t.local' }); identities.set('good-token', { email: 'g@t.local', emailVerified: true });
    const res = await google(app, 'good-token');
    expect(res.statusCode).toBe(200); expect(res.json().data.accessToken).toBeTypeOf('string'); expect(res.json().data.user.id).toBe(u.id);
    expect(res.cookies.find((c) => c.name === 'ot_refresh')).toBeDefined();
  });
  it('matches email case-insensitively', async () => {
    await createUser(db, { email: 'case@t.local' }); identities.set('case-token-1', { email: 'Case@T.local', emailVerified: true });
    expect((await google(app, 'case-token-1')).statusCode).toBe(200);
  });
  it('rejects an invalid token with 401 GOOGLE_TOKEN_INVALID', async () => {
    const res = await google(app, 'nope-nope-nope'); expect(res.statusCode).toBe(401); expect(res.json().code).toBe('GOOGLE_TOKEN_INVALID');
  });
  it('rejects unverified email', async () => {
    await createUser(db, { email: 'unv@t.local' }); identities.set('unverified-tok', { email: 'unv@t.local', emailVerified: false });
    const res = await google(app, 'unverified-tok'); expect(res.statusCode).toBe(401); expect(res.json().code).toBe('GOOGLE_TOKEN_INVALID');
  });
  it('rejects an unknown address with 403 GOOGLE_ACCOUNT_UNKNOWN', async () => {
    identities.set('stranger-token', { email: 'who@t.local', emailVerified: true });
    const res = await google(app, 'stranger-token'); expect(res.statusCode).toBe(403); expect(res.json().code).toBe('GOOGLE_ACCOUNT_UNKNOWN');
    expect(res.json().message).toBe('No OverTrack account for this Google address. Ask your admin.');
  });
  it('rejects an inactive user with 401 USER_INACTIVE', async () => {
    await createUser(db, { email: 'off@t.local', isActive: false }); identities.set('inactive-token', { email: 'off@t.local', emailVerified: true });
    const res = await google(app, 'inactive-token'); expect(res.statusCode).toBe(401); expect(res.json().code).toBe('USER_INACTIVE');
  });
  it('validates the body', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: 'short' } })).statusCode).toBe(400);
  });
});

describe('auth/google when GOOGLE_CLIENT_ID is unset', () => {
  it('returns 503 GOOGLE_SIGNIN_DISABLED', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const app = await createTestApp();
    const res = await google(app, 'anything-long-enough'); expect(res.statusCode).toBe(503); expect(res.json().code).toBe('GOOGLE_SIGNIN_DISABLED');
    await app.close();
  });
});
