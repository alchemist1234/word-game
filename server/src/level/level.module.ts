import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { LevelService } from './level.service'
import { LevelController } from './level.controller'
import { GameModule } from '../game/game.module'
import { AuthModule } from '../auth/auth.module'
import { UserProgressEntity } from '../user/user-progress.entity'
import { EconomyModule } from '../economy/economy.module'

@Module({
  imports: [
    GameModule,
    AuthModule,
    EconomyModule,
    TypeOrmModule.forFeature([UserProgressEntity]),
  ],
  controllers: [LevelController],
  providers: [LevelService],
  exports: [LevelService],
})
export class LevelModule {}
