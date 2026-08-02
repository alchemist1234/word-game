import { Module } from '@nestjs/common'
import { GameService } from './game.service'
import { GameController } from './game.controller'
import { GridPoolModule } from '../grid-pool/grid-pool.module'
import { DictionaryModule } from '../dictionary/dictionary.module'

@Module({
  imports: [GridPoolModule, DictionaryModule],
  controllers: [GameController],
  providers: [GameService],
})
export class GameModule {}
