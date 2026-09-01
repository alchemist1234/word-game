import { Controller, Get, Req, UseGuards } from '@nestjs/common'
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
}
