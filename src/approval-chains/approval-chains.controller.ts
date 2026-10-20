import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { Levels } from '@/common/auth/levels.decorator';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { AuthUser } from '@/common/auth/auth-user';
import { ApprovalChainsService } from './approval-chains.service';
import { ReplaceChainDto } from './approval-chains.dto';

@Controller('teams/:teamId/chain')
export class ApprovalChainsController {
  constructor(private readonly chains: ApprovalChainsService) {}
  @Get() async get(@Param('teamId', ParseUUIDPipe) teamId: string) { return { data: await this.chains.getForTeam(teamId) }; }
  @Put() @Levels('admin') async replace(@Param('teamId', ParseUUIDPipe) teamId: string, @Body() dto: ReplaceChainDto, @CurrentUser() actor: AuthUser) { return { data: await this.chains.replaceForTeam(actor.id, teamId, dto) }; }
}
