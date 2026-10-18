import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';
import { DomainError } from './domain-error';

/** Minimal structural view of the Fastify reply used here (fastify is not a direct dependency). */
interface HttpReply {
  status(code: number): { send(body: unknown): unknown };
}

const STATUS_TO_CODE: Record<number, string> = { 400: 'VALIDATION_FAILED', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'ATTACHMENT_TOO_LARGE', 429: 'RATE_LIMITED' };

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<HttpReply>();

    if (exception instanceof DomainError) {
      const body: Record<string, unknown> = { statusCode: exception.status, code: exception.code, message: exception.message };
      if (exception.details !== undefined) body.details = exception.details;
      return reply.status(exception.status).send(body);
    }
    if (exception instanceof ZodValidationException) {
      // nestjs-zod v5 types getZodError() as unknown; it is always a ZodError here.
      const details = (exception.getZodError() as ZodError).issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return reply.status(400).send({ statusCode: 400, code: 'VALIDATION_FAILED', message: 'Validation failed', details });
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message = typeof res === 'string' ? res : ((res as { message?: string | string[] }).message ?? exception.message);
      return reply.status(status).send({ statusCode: status, code: STATUS_TO_CODE[status] ?? 'HTTP_ERROR', message: Array.isArray(message) ? message.join(', ') : message });
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({ statusCode: 500, code: 'INTERNAL', message: 'Internal server error' });
  }
}
