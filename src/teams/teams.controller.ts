import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '@/common/auth/roles.decorator';
import { TeamsService } from './teams.service';
import { CreateTeamDto, ListTeamsQueryDto, UpdateTeamDto } from './teams.dto';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}
  @Get() list(@Query() q: ListTeamsQueryDto) { return this.teams.list(q); }
  @Get(':id') async get(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.teams.findById(id) }; }
  @Get(':id/members') async members(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.teams.members(id) }; }
  @Post() @Roles('admin') async create(@Body() dto: CreateTeamDto) { return { data: await this.teams.create(dto) }; }
  @Patch(':id') @Roles('admin') async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeamDto) { return { data: await this.teams.update(id, dto) }; }
}
