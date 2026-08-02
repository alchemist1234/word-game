import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { GameService } from './game.service'
import { GameGateway } from './game.gateway'
import { GameController } from './game.controller'
import { GridPoolModule } from '../grid-pool/grid-pool.module'
import { DictionaryModule } from '../dictionary/dictionary.module'
import { AuthModule } from '../auth/auth.module'
import { UserFoundWordEntity } from '../user/user-found-word.entity'

@Module({
  imports: [
    GridPoolModule,
    DictionaryModule,
    AuthModule,
    TypeOrmModule.forFeature([UserFoundWordEntity]),
  ],
  controllers: [GameController],
  providers: [GameService, GameGateway],
  exports: [GameService],
})
export class GameModule {}
