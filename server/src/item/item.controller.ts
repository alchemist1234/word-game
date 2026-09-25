import { Controller, Get, Post, Body, Req, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt.guard'
import { ItemService } from './item.service'

@Controller()
@UseGuards(JwtAuthGuard)
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  @Get('items')
  getItems(@Query('mode') mode?: string, @Query('bossOnly') bossOnly?: string) {
    const items = this.itemService.getItems().filter((item) => {
      if (mode && !item.allowedModes.includes(mode)) return false
      if (bossOnly === 'true' && !item.bossOnly) return false
      if (bossOnly === 'false' && item.bossOnly) return false
      return true
    })
    return { items }
  }

  @Get('inventory')
  getInventory(@Req() req: { user: { userId: number } }) {
    return this.itemService.getInventory(req.user.userId).then((items) => ({ items }))
  }

  @Post('item/use')
  useItem(
    @Body() body: { matchSessionId: string; itemId: string },
    @Req() req: { user: { userId: number } },
  ) {
    return this.itemService.useItem(req.user.userId, body.matchSessionId, body.itemId)
  }

  @Post('shop/buy')
  buy(
    @Body() body: { itemId: string; quantity?: number },
    @Req() req: { user: { userId: number } },
  ) {
    return this.itemService.purchase(req.user.userId, body.itemId, body.quantity ?? 1)
  }
}
