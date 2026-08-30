import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DailyChallengeEntity } from './daily-challenge.entity'
import { DailyAttemptEntity } from './daily-attempt.entity'
import { DailyService } from './daily.service'
import { DailyController } from './daily.controller'
import { GameModule } from '../game/game.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionary/dictionary.module'
import { LeaderboardSnapshotEntity } from '../leaderboard/leaderboard-snapshot.entity'
import { UserEntity } from '../user/user.entity'

@Module({
  imports: [
    GameModule,
    AuthModule,
    DictionaryModule,
    TypeOrmModule.forFeature([DailyChallengeEntity, DailyAttemptEntity, LeaderboardSnapshotEntity, UserEntity]),
  ],
  controllers: [DailyController],
  providers: [DailyService],
  exports: [DailyService],
})
export class DailyModule {}
