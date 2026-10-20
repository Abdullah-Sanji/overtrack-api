import { describe, it, expect } from 'vitest';
import { parseTrustProxy, validateEnv } from './env';

describe('parseTrustProxy', () => {
  it('parses booleans and hop counts', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('2')).toBe(2);
  });
  it('rejects garbage', () => { expect(() => parseTrustProxy('yes')).toThrow(); });
});

describe('validateEnv GOOGLE_CLIENT_ID', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db', JWT_SECRET: 'x'.repeat(32), WEB_URL: 'http://localhost:5173', CORS_ORIGIN: 'http://localhost:5173', SMTP_URL: 'smtp://localhost:1025', MAIL_FROM: 'a@b.co' };
  it('treats an empty string as unset (compose passes "" when the host has no value)', () => {
    expect(validateEnv({ ...base, GOOGLE_CLIENT_ID: '' }).GOOGLE_CLIENT_ID).toBeUndefined();
    expect(validateEnv(base).GOOGLE_CLIENT_ID).toBeUndefined();
    expect(validateEnv({ ...base, GOOGLE_CLIENT_ID: 'cid' }).GOOGLE_CLIENT_ID).toBe('cid');
  });
});
