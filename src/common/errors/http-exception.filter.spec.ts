import { describe, it, expect, vi } from 'vitest';
import { ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import { HttpExceptionFilter } from './http-exception.filter';
import { DomainError } from './domain-error';

function host() {
  const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
  const h = { switchToHttp: () => ({ getResponse: () => reply, getRequest: () => ({ url: '/x' }) }) } as unknown as ArgumentsHost;
  return { h, reply };
}

describe('HttpExceptionFilter', () => {
  it('maps DomainError to its status and code', () => {
    const { h, reply } = host();
    new HttpExceptionFilter().catch(new DomainError('SHEET_NOT_EDITABLE', 'Sheet is locked', 409), h);
    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith({ statusCode: 409, code: 'SHEET_NOT_EDITABLE', message: 'Sheet is locked' });
  });
  it('maps zod validation to VALIDATION_FAILED with field details', () => {
    const { h, reply } = host();
    const err = z.object({ email: z.string().email() }).safeParse({ email: 'x' });
    new HttpExceptionFilter().catch(new ZodValidationException((err as { error: z.ZodError }).error), h);
    expect(reply.status).toHaveBeenCalledWith(400);
    const body = reply.send.mock.calls[0][0];
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details[0].path).toBe('email');
  });
  it('maps Nest HttpException to its status with a generic code', () => {
    const { h, reply } = host();
    new HttpExceptionFilter().catch(new NotFoundException('nope'), h);
    expect(reply.send).toHaveBeenCalledWith({ statusCode: 404, code: 'NOT_FOUND', message: 'nope' });
  });
  it('maps unknown errors to 500 INTERNAL and logs them', () => {
    const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { h, reply } = host();
    new HttpExceptionFilter().catch(new Error('boom'), h);
    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send.mock.calls[0][0].code).toBe('INTERNAL');
    expect(logError).toHaveBeenCalled();
    logError.mockRestore();
  });
});
