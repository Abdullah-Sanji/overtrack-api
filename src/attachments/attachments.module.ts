import { Module } from '@nestjs/common';
import { SheetsModule } from '@/sheets/sheets.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { StorageService } from './storage.service';
@Module({ imports: [SheetsModule], controllers: [AttachmentsController], providers: [AttachmentsService, StorageService] })
export class AttachmentsModule {}
