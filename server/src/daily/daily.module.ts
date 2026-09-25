import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DailyChallengeEntity } from './daily-challenge.entity'
import { DailyAttemptEntity } from './daily-attempt.entity'
import { DailyRewardClaimEntity } from './daily-reward-claim.entity'
import { DailyService } from './daily.service'
import { DailyController } from './daily.controller'
import { GameModule } from '../game/game.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionary/dictionary.module'
import { LeaderboardSnapshotEntity } from '../leaderboard/leaderboard-snapshot.entity'
import { UserEntity } from '../user/user.entity'
import { RankModule } from '../rank/rank.module'
import { AchievementModule } from '../achievement/achievement.module'

@Module({
  imports: [
    GameModule,
    AuthModule,
    DictionaryModule,
    RankModule,
    AchievementModule,
    TypeOrmModule.forFeature([DailyChallengeEntity, DailyAttemptEntity, DailyRewardClaimEntity, LeaderboardSnapshotEntity, UserEntity]),
  ],
  controllers: [DailyController],
  providers: [DailyService],
  exports: [DailyService],
})
export class DailyModule {}
