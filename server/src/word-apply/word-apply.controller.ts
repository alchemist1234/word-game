import { Controller, Get, Post, Body, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt.guard'
import { WordApplyService } from './word-apply.service'
import type { CellPos } from '../grid-gen/types'

@Controller('word-applies')
@UseGuards(JwtAuthGuard)
export class WordApplyController {
  constructor(private readonly wordApplyService: WordApplyService) {}

  @Post()
  apply(
    @Body() body: { word: string; matchSessionId?: string; cells?: CellPos[] },
    @Req() req: { user: { userId: number } },
  ) {
    return this.wordApplyService.apply(
      req.user.userId,
      body.word,
      body.matchSessionId,
      body.cells,
    )
  }

  @Get('mine')
  mine(@Req() req: { user: { userId: number } }) {
    return this.wordApplyService.mine(req.user.userId)
  }

  @Get('supporters')
  supporters(
    @Query('word') word: string,
    @Req() req: { user: { userId: number } },
  ) {
    return this.wordApplyService.supporters(word, req.user.userId)
  }
}
