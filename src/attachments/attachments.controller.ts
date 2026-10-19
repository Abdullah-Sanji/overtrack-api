import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { DomainError } from '@/common/errors/domain-error';
import { AttachmentsService } from './attachments.service';

const tooLarge = () => new DomainError('ATTACHMENT_TOO_LARGE', 'File exceeds 5 MB', 413);

@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('sheets/:id/entries/:entryId/attachment')
  async upload(@Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string, @Req() req: FastifyRequest, @CurrentUser() actor: AuthUser) {
    const part = await req.file();
    if (!part) throw new DomainError('VALIDATION_FAILED', 'Missing file field', 400);
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge();
      throw err;
    }
    if (part.file.truncated) throw tooLarge();
    return { data: await this.attachments.attachToEntry(actor, id, entryId, { filename: part.filename, mimetype: part.mimetype, buffer }) };
  }

  @Delete('sheets/:id/entries/:entryId/attachment') @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string, @CurrentUser() actor: AuthUser) { await this.attachments.detach(actor, id, entryId); }

  @Get('attachments/:id')
  async download(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Res() reply: FastifyReply) {
    const { stream, mimeType, originalName } = await this.attachments.open(actor, id);
    reply.header('content-type', mimeType).header('content-disposition', `inline; filename="${encodeURIComponent(originalName)}"`);
    return reply.send(stream);
  }
}
