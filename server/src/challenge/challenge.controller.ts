import { Controller, Post, Get, Body, Param, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt.guard'
import { ChallengeService } from './challenge.service'
import { CreateChallengeDto, SubmitChallengeDto } from './dto'

@Controller('challenge')
@UseGuards(JwtAuthGuard)
export class ChallengeController {
  constructor(private readonly challengeService: ChallengeService) {}

  @Post('create')
  create(@Req() req: { user: { userId: number } }, @Body() dto: CreateChallengeDto) {
    return this.challengeService.create(req.user.userId, dto.matchSessionId)
  }

  @Get('mine')
  mine(@Req() req: { user: { userId: number } }) {
    return this.challengeService.mine(req.user.userId)
  }

  @Get(':id')
  getDetail(@Param('id') id: string, @Req() req: { user: { userId: number } }) {
    return this.challengeService.getDetail(id, req.user.userId)
  }

  @Post(':id/start')
  start(@Param('id') id: string, @Req() req: { user: { userId: number } }) {
    return this.challengeService.start(id, req.user.userId)
  }

  @Post(':id/submit')
  submit(
    @Param('id') id: string,
    @Req() req: { user: { userId: number } },
    @Body() dto: SubmitChallengeDto,
  ) {
    return this.challengeService.submit(id, req.user.userId, dto.matchSessionId)
  }
}
