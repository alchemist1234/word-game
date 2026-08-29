import { Controller, Post, Get, Delete, Req, UseGuards } from '@nestjs/common'
import { MatchService } from './match.service'
import { JwtAuthGuard } from '../auth/jwt.guard'

@Controller('match')
@UseGuards(JwtAuthGuard)
export class MatchController {
  constructor(private readonly matchService: MatchService) {}

  /** 入队匹配（对战固定 standard 5×5，180s） */
  @Post('queue')
  queue(@Req() req: { user: { userId: number } }) {
    return this.matchService.queue(req.user.userId)
  }

  /** 轮询状态：queued / matched / timeout */
  @Get('queue')
  queueStatus(@Req() req: { user: { userId: number } }) {
    return this.matchService.queueStatus(req.user.userId)
  }

  /** 取消排队 */
  @Delete('queue')
  cancel(@Req() req: { user: { userId: number } }) {
    return this.matchService.cancelQueue(req.user.userId)
  }
}
