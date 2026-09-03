import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { LevelService } from './level.service'
import { LevelController } from './level.controller'
import { GameModule } from '../game/game.module'
import { AuthModule } from '../auth/auth.module'
import { UserProgressEntity } from '../user/user-progress.entity'
import { EconomyModule } from '../economy/economy.module'
import { AchievementModule } from '../achievement/achievement.module'
import { DictionaryModule } from '../dictionary/dictionary.module'

@Module({
  imports: [
    GameModule,
    AuthModule,
    EconomyModule,
    AchievementModule,
    DictionaryModule,
    TypeOrmModule.forFeature([UserProgressEntity]),
  ],
  controllers: [LevelController],
  providers: [LevelService],
  exports: [LevelService],
})
export class LevelModule {}
