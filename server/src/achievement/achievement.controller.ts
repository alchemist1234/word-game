import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt.guard'
import { AchievementService } from './achievement.service'

@Controller('achievements')
@UseGuards(JwtAuthGuard)
export class AchievementController {
  constructor(private readonly service: AchievementService) {}

  @Get()
  list(@Req() req: { user: { userId: number } }) {
    return this.service.list(req.user.userId).then((list) => ({ list }))
  }

  @Post('claim')
  claim(@Body() body: { achievementId: string }, @Req() req: { user: { userId: number } }) {
    return this.service.claim(req.user.userId, body.achievementId)
  }

  @Post('check')
  check(@Body() body: { event: string; payload?: Record<string, unknown> }, @Req() req: { user: { userId: number } }) {
    return this.service.check(req.user.userId, body.event, body.payload ?? {}).then(() => ({ ok: true }))
  }
}
