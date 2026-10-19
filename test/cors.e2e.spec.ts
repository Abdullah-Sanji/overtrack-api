import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './helpers/app';

const url = '/api/v1/teams/00000000-0000-0000-0000-000000000000/chain';

describe('CORS preflight', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  it('allows PUT, PATCH and DELETE from a listed origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url,
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect([200, 204]).toContain(res.statusCode);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const methods = String(res.headers['access-control-allow-methods']);
    for (const m of ['PUT', 'PATCH', 'DELETE']) expect(methods).toContain(m);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not allow an unlisted origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url,
      headers: { origin: 'http://evil.test', 'access-control-request-method': 'PUT' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
