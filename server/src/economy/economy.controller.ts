import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt.guard'
import { EconomyService } from './economy.service'

@Controller('economy')
@UseGuards(JwtAuthGuard)
export class EconomyController {
  constructor(private readonly economyService: EconomyService) {}

  @Get('me')
  getMe(@Req() req: { user: { userId: number } }) {
    return this.economyService.getBalance(req.user.userId)
  }

  @Get('balance')
  getBalance(@Req() req: { user: { userId: number } }) {
    return this.economyService.getBalance(req.user.userId)
  }

  @Get('store/balance')
  getStoreBalance(@Req() req: { user: { userId: number } }) {
    return this.economyService.getBalance(req.user.userId)
  }

  @Post('consume')
  consume(
    @Req() req: { user: { userId: number } },
    @Body() body: { type?: string; amount?: number },
  ) {
    if (body.type !== 'stamina') {
      return { ok: false, message: '仅支持消耗体力' }
    }
    return this.economyService
      .consumeStamina(req.user.userId, body.amount ?? 1)
      .then(() => ({ ok: true }))
  }
}
