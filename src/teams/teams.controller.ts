import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { Roles } from '@/common/auth/roles.decorator';
import { TeamsService } from './teams.service';
import { CreateTeamDto, ListTeamsQueryDto, UpdateTeamDto } from './teams.dto';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}
  @Get() list(@Query() q: ListTeamsQueryDto) { return this.teams.list(q); }
  @Get(':id') async get(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.teams.findById(id) }; }
  @Get(':id/members') async members(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.teams.members(id) }; }
  @Post() @Roles('admin') async create(@CurrentUser() actor: AuthUser, @Body() dto: CreateTeamDto) { return { data: await this.teams.create(actor.id, dto) }; }
  @Patch(':id') @Roles('admin') async update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeamDto) { return { data: await this.teams.update(actor.id, id, dto) }; }
}
