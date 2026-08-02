import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common'
import { LevelService } from './level.service'
import { JwtAuthGuard } from '../auth/jwt.guard'

@Controller('level')
@UseGuards(JwtAuthGuard)
export class LevelController {
  constructor(private readonly levelService: LevelService) {}

  @Get('chapters')
  chapters(@Req() req: { user: { userId: number } }) {
    return this.levelService.getChapters(req.user.userId)
  }

  @Post('start')
  start(
    @Body() body: { levelId: string },
    @Req() req: { user: { userId: number } },
  ) {
    return this.levelService.startLevel(req.user.userId, body.levelId)
  }

  @Post('submit')
  submit(
    @Body() body: { matchSessionId: string },
    @Req() req: { user: { userId: number } },
  ) {
    return this.levelService.submitLevel(req.user.userId, body.matchSessionId)
  }
}
