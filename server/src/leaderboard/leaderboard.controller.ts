import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt.guard'
import { LeaderboardService } from './leaderboard.service'

@Controller('leaderboard')
@UseGuards(JwtAuthGuard)
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get()
  get(@Req() req: { user: { userId: number } }, @Query('type') type: string) {
    return this.leaderboardService.get(req.user.userId, type || 'daily')
  }
}
