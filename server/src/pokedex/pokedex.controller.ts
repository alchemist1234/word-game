import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { PokedexService } from './pokedex.service'
import { JwtAuthGuard } from '../auth/jwt.guard'

@Controller('pokedex')
@UseGuards(JwtAuthGuard)
export class PokedexController {
  constructor(private readonly pokedexService: PokedexService) {}

  @Get()
  get(@Req() req: { user: { userId: number } }) {
    return this.pokedexService.getPokedex(req.user.userId)
  }
}
