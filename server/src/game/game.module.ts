import { Module, forwardRef } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { GameService } from './game.service'
import { GameGateway } from './game.gateway'
import { GameController } from './game.controller'
import { GridPoolModule } from '../grid-pool/grid-pool.module'
import { DictionaryModule } from '../dictionary/dictionary.module'
import { AuthModule } from '../auth/auth.module'
import { UserFoundWordEntity } from '../user/user-found-word.entity'
import { MatchModule } from '../match/match.module'
import { AchievementModule } from '../achievement/achievement.module'
import { GameSettlementEntity } from './game-settlement.entity'

@Module({
  imports: [
    GridPoolModule,
    DictionaryModule,
    AuthModule,
    forwardRef(() => MatchModule),
    forwardRef(() => AchievementModule),
    TypeOrmModule.forFeature([UserFoundWordEntity, GameSettlementEntity]),
  ],
  controllers: [GameController],
  providers: [GameService, GameGateway],
  exports: [GameService, GameGateway],
})
export class GameModule {}
