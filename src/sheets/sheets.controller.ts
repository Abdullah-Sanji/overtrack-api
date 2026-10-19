import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { SheetsService } from './sheets.service';
import { EntriesService } from './entries.service';
import { CreateEntryDto, ForPeriodDto, ListSheetsQueryDto, UpdateEntryDto } from './sheets.dto';

@Controller('sheets')
export class SheetsController {
  constructor(private readonly sheets: SheetsService, private readonly entries: EntriesService) {}

  @Get() list(@Query() q: ListSheetsQueryDto, @CurrentUser() actor: AuthUser) { return this.sheets.list(q, actor); }
  @Post('for-period') @HttpCode(200) async forPeriod(@Body() dto: ForPeriodDto, @CurrentUser() actor: AuthUser) { return { data: await this.sheets.getOrCreateForPeriod(actor.id, dto.period) }; }
  @Get(':id') async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) { return { data: await this.sheets.findDetail(id, actor) }; }
  @Post(':id/entries') async addEntry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateEntryDto, @CurrentUser() actor: AuthUser) { return { data: await this.entries.create(actor, id, dto) }; }
  @Patch(':id/entries/:entryId') async updateEntry(@Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string, @Body() dto: UpdateEntryDto, @CurrentUser() actor: AuthUser) { return { data: await this.entries.update(actor, id, entryId, dto) }; }
  @Delete(':id/entries/:entryId') @HttpCode(204) async removeEntry(@Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string, @CurrentUser() actor: AuthUser) { await this.entries.remove(actor, id, entryId); }
}
