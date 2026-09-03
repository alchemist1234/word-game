import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt.guard'
import { ItemService } from './item.service'

@Controller()
@UseGuards(JwtAuthGuard)
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  @Get('items')
  getItems() {
    return { items: this.itemService.getItems() }
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
