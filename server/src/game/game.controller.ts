import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { GameService } from './game.service'
import { JwtAuthGuard } from '../auth/jwt.guard'
import { GetGridDto } from './dto/get-grid.dto'
import { SubmitWordDto } from './dto/submit-word.dto'
import { EndGameDto } from './dto/end-game.dto'

@Controller('game')
@UseGuards(JwtAuthGuard)
export class GameController {
  constructor(private readonly gameService: GameService) {}

  @Get('grid')
  getGrid(
    @Query() dto: GetGridDto,
    @Req() req: { user: { userId: number } },
  ) {
    return this.gameService.getGrid(dto.difficulty ?? 'standard', req.user.userId)
  }

  @Post('word')
  submitWord(@Body() dto: SubmitWordDto) {
    return this.gameService.submitWord(dto.matchSessionId, dto.word, dto.cells)
  }

  @Post('end')
  endGame(@Body() dto: EndGameDto) {
    return this.gameService.endGame(dto.matchSessionId)
  }
}
