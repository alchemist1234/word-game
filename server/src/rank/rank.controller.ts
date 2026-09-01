import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt.guard'
import { RankService } from './rank.service'

@Controller('rank')
@UseGuards(JwtAuthGuard)
export class RankController {
  constructor(private readonly rankService: RankService) {}
  @Get('me')
  getMe(@Req() req: { user: { userId: number } }) {
    return this.rankService.getRankMe(req.user.userId)
  }
}
