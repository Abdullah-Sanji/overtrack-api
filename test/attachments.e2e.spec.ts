import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, bearer } from './helpers/app';
import { truncateAll } from './helpers/db';
import { createUser, createOvertimeType, createSheet, createEntry } from './helpers/factories';
import { DrizzleService } from '@/database/drizzle.service';

function multipart(fields: { name: string; filename: string; type: string; data: Buffer }) {
  const boundary = '----overtrack';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fields.name}"; filename="${fields.filename}"\r\nContent-Type: ${fields.type}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, fields.data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('attachments', () => {
  let app: NestFastifyApplication; let db: DrizzleService['db']; let token: string; let sheetId: string; let entryId: string;
  beforeAll(async () => { app = await createTestApp(); db = app.get(DrizzleService).db; });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await truncateAll(db);
    const emp = await createUser(db); token = (await login(app, emp.email, emp.password)).accessToken;
    const type = await createOvertimeType(db); const sheet = await createSheet(db, emp.id); sheetId = sheet.id;
    entryId = (await createEntry(db, sheetId, type.id)).id;
  });

  it('uploads a png, lists it on the entry, downloads it, deletes it', async () => {
    const m = multipart({ name: 'file', filename: 'proof.png', type: 'image/png', data: PNG });
    const up = await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheetId}/entries/${entryId}/attachment`, headers: { ...bearer(token), ...m.headers }, payload: m.payload });
    expect(up.statusCode).toBe(201);
    const att = up.json().data; expect(att).toMatchObject({ originalName: 'proof.png', mimeType: 'image/png', sizeBytes: PNG.length });
    const detail = await app.inject({ method: 'GET', url: `/api/v1/sheets/${sheetId}`, headers: bearer(token) });
    expect(detail.json().data.entries[0].attachment.id).toBe(att.id);
    const dl = await app.inject({ method: 'GET', url: `/api/v1/attachments/${att.id}`, headers: bearer(token) });
    expect(dl.statusCode).toBe(200); expect(dl.headers['content-type']).toBe('image/png'); expect(dl.rawPayload.equals(PNG)).toBe(true);
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/sheets/${sheetId}/entries/${entryId}/attachment`, headers: bearer(token) });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/v1/attachments/${att.id}`, headers: bearer(token) })).statusCode).toBe(404);
  });

  it('rejects disallowed types and a second attachment', async () => {
    const bad = multipart({ name: 'file', filename: 'x.exe', type: 'application/octet-stream', data: PNG });
    const r = await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheetId}/entries/${entryId}/attachment`, headers: { ...bearer(token), ...bad.headers }, payload: bad.payload });
    expect(r.json().code).toBe('ATTACHMENT_TYPE');
    const ok = multipart({ name: 'file', filename: 'a.png', type: 'image/png', data: PNG });
    await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheetId}/entries/${entryId}/attachment`, headers: { ...bearer(token), ...ok.headers }, payload: ok.payload });
    const second = await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheetId}/entries/${entryId}/attachment`, headers: { ...bearer(token), ...ok.headers }, payload: ok.payload });
    expect(second.json().code).toBe('ATTACHMENT_EXISTS');
  });

  it('strangers cannot download', async () => {
    const ok = multipart({ name: 'file', filename: 'a.png', type: 'image/png', data: PNG });
    const up = await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheetId}/entries/${entryId}/attachment`, headers: { ...bearer(token), ...ok.headers }, payload: ok.payload });
    const other = await createUser(db); const ot = (await login(app, other.email, other.password)).accessToken;
    expect((await app.inject({ method: 'GET', url: `/api/v1/attachments/${up.json().data.id}`, headers: bearer(ot) })).statusCode).toBe(403);
  });

  it('rejects files over 5 MB with 413', async () => {
    const big = multipart({ name: 'file', filename: 'big.png', type: 'image/png', data: Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 1 - PNG.length)]) });
    const r = await app.inject({ method: 'POST', url: `/api/v1/sheets/${sheetId}/entries/${entryId}/attachment`, headers: { ...bearer(token), ...big.headers }, payload: big.payload });
    expect(r.statusCode).toBe(413);
    expect(r.json().code).toBe('ATTACHMENT_TOO_LARGE');
  });
});
