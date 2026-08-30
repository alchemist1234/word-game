import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt.guard'
import { DailyService } from './daily.service'
import { SubmitDailyDto } from './dto'

@Controller('daily')
@UseGuards(JwtAuthGuard)
export class DailyController {
  constructor(private readonly dailyService: DailyService) {}

  @Get()
  getDaily(@Req() req: { user: { userId: number } }) {
    return this.dailyService.getDailyInfo(req.user.userId)
  }

  @Post('start')
  start(@Req() req: { user: { userId: number } }) {
    return this.dailyService.startDaily(req.user.userId)
  }

  @Post('submit')
  submit(@Req() req: { user: { userId: number } }, @Body() dto: SubmitDailyDto) {
    return this.dailyService.submitDaily(req.user.userId, dto.matchSessionId)
  }
}
