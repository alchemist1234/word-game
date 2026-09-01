import { Controller, Post, Get, Delete, Req, UseGuards, Body, Query } from '@nestjs/common'
import { MatchService } from './match.service'
import { JwtAuthGuard } from '../auth/jwt.guard'

@Controller('match')
@UseGuards(JwtAuthGuard)
export class MatchController {
  constructor(private readonly matchService: MatchService) {}

  @Post('queue')
  queue(@Req() req: { user: { userId: number } }, @Body() body?: { size?: number; mode?: string }) {
    const size = body?.size === 4 ? 4 : 2
    const mode = body?.mode ?? 'casual'
    return this.matchService.queue(req.user.userId, { size, mode })
  }

  @Get('queue')
  queueStatus(@Req() req: { user: { userId: number } }, @Query('size') sizeQuery?: string) {
    const size = sizeQuery === '4' ? 4 : 2
    return this.matchService.queueStatus(req.user.userId, { size })
  }

  @Delete('queue')
  cancel(@Req() req: { user: { userId: number } }, @Query('size') sizeQuery?: string) {
    const size = sizeQuery === '4' ? 4 : undefined
    if (size === 4) return this.matchService.cancelQueue4p(req.user.userId)
    // cancel both to be safe
    return this.matchService.cancelQueue(req.user.userId).then(async (r) => {
      await this.matchService.cancelQueue4p(req.user.userId)
      return r
    })
  }

  @Post('abandon')
  async abandon(@Req() req: { user: { userId: number } }) {
    await this.matchService.abandon(req.user.userId)
    return { ok: true }
  }
}
