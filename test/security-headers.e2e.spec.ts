import { describe, it, expect, vi } from 'vitest';
import { createTestApp } from './helpers/app';

// Own file: ConfigModule reads env once when AppModule is imported, and the production CSP is only
// enabled when Swagger (which needs inline scripts) is not mounted.
vi.hoisted(() => { process.env.NODE_ENV = 'production'; });

describe('security headers in production', () => {
  it('sends a locked-down Content-Security-Policy on API responses', async () => {
    const app = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    await app.close();
  });
});
