import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { attachments, sheetEntries, sheets, users } from '@/database/schema';
import { AuthUser } from '@/common/auth/auth-user';
import { DomainError, forbidden, notFound } from '@/common/errors/domain-error';
import { VisibilityService } from '@/sheets/visibility.service';
import { StorageService } from './storage.service';

const ALLOWED: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };
const MAGIC: Array<[string, Buffer]> = [['image/png', Buffer.from('89504e47', 'hex')], ['image/jpeg', Buffer.from('ffd8ff', 'hex')], ['application/pdf', Buffer.from('%PDF')]];
const EDITABLE = new Set(['draft', 'rejected']);

export interface UploadedFile { filename: string; mimetype: string; buffer: Buffer }

@Injectable()
export class AttachmentsService {
  constructor(private readonly drizzle: DrizzleService, private readonly storage: StorageService, private readonly visibility: VisibilityService) {}

  private async ownedEditableEntry(actor: AuthUser, sheetId: string, entryId: string) {
    const [r] = await this.drizzle.db.select({ entry: sheetEntries, sheet: sheets }).from(sheetEntries).innerJoin(sheets, eq(sheets.id, sheetEntries.sheetId)).where(and(eq(sheetEntries.id, entryId), eq(sheetEntries.sheetId, sheetId)));
    if (!r) throw notFound('Entry');
    if (r.sheet.employeeId !== actor.id) throw forbidden();
    if (!EDITABLE.has(r.sheet.status)) throw new DomainError('SHEET_NOT_EDITABLE', 'Sheet is locked', 409);
    return r;
  }

  async attachToEntry(actor: AuthUser, sheetId: string, entryId: string, file: UploadedFile) {
    const { entry } = await this.ownedEditableEntry(actor, sheetId, entryId);
    if (entry.attachmentId) throw new DomainError('ATTACHMENT_EXISTS', 'Entry already has an attachment', 409);
    const ext = ALLOWED[file.mimetype];
    const sniffed = MAGIC.find(([, sig]) => file.buffer.subarray(0, sig.length).equals(sig))?.[0];
    if (!ext || sniffed !== file.mimetype) throw new DomainError('ATTACHMENT_TYPE', 'Only PNG, JPEG and PDF files are allowed', 400);
    const key = await this.storage.save(file.buffer, ext);
    return this.drizzle.db.transaction(async (tx) => {
      const [a] = await tx.insert(attachments).values({ ownerId: actor.id, storageKey: key, originalName: file.filename.slice(0, 200), mimeType: file.mimetype, sizeBytes: file.buffer.length }).returning();
      await tx.update(sheetEntries).set({ attachmentId: a.id, updatedAt: new Date() }).where(eq(sheetEntries.id, entryId));
      return { id: a.id, originalName: a.originalName, mimeType: a.mimeType, sizeBytes: a.sizeBytes };
    });
  }

  async detach(actor: AuthUser, sheetId: string, entryId: string): Promise<void> {
    const { entry } = await this.ownedEditableEntry(actor, sheetId, entryId);
    if (!entry.attachmentId) throw notFound('Attachment');
    const [a] = await this.drizzle.db.select().from(attachments).where(eq(attachments.id, entry.attachmentId));
    await this.drizzle.db.transaction(async (tx) => {
      await tx.update(sheetEntries).set({ attachmentId: null }).where(eq(sheetEntries.id, entryId));
      await tx.delete(attachments).where(eq(attachments.id, entry.attachmentId!));
    });
    if (a) await this.storage.remove(a.storageKey);
  }

  async open(actor: AuthUser, attachmentId: string) {
    const [r] = await this.drizzle.db.select({ a: attachments, sheet: sheets, teamId: users.teamId }).from(attachments)
      .innerJoin(sheetEntries, eq(sheetEntries.attachmentId, attachments.id)).innerJoin(sheets, eq(sheets.id, sheetEntries.sheetId)).innerJoin(users, eq(users.id, sheets.employeeId))
      .where(eq(attachments.id, attachmentId));
    if (!r) throw notFound('Attachment');
    if (!(await this.visibility.canViewSheet(actor, { id: r.sheet.id, employeeId: r.sheet.employeeId, teamId: r.teamId, sheetTeamId: r.sheet.teamId }))) throw forbidden();
    return { stream: this.storage.stream(r.a.storageKey), mimeType: r.a.mimeType, originalName: r.a.originalName };
  }
}
