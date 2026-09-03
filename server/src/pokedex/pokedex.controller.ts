import { Controller, Get, Req, UseGuards, Query } from '@nestjs/common'
import { PokedexService } from './pokedex.service'
import { JwtAuthGuard } from '../auth/jwt.guard'

@Controller('pokedex')
@UseGuards(JwtAuthGuard)
export class PokedexController {
  constructor(private readonly pokedexService: PokedexService) {}

  @Get()
  get(
    @Req() req: { user: { userId: number } },
    @Query('groupBy') groupBy?: string,
    @Query('rarity') rarity?: string,
    @Query('tag') tag?: string,
  ) {
    return this.pokedexService.getPokedex(req.user.userId, { groupBy, rarity, tag })
  }

  @Get('titles')
  getTitles(@Req() req: { user: { userId: number } }) {
    return this.pokedexService.getTitles(req.user.userId)
  }
}
