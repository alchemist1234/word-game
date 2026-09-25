import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserEntity } from '../user/user.entity'
import { MatchPlayerEntity } from '../match/match-player.entity'
import { MatchEntity } from '../match/match.entity'
import { SeasonSettlementEntity } from './season-settlement.entity'
import { LeaderboardSnapshotEntity } from '../leaderboard/leaderboard-snapshot.entity'
import { RankService } from './rank.service'
import { RankController } from './rank.controller'
import { AuthModule } from '../auth/auth.module'
import { AchievementModule } from '../achievement/achievement.module'

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, MatchEntity, MatchPlayerEntity, LeaderboardSnapshotEntity, SeasonSettlementEntity]), AuthModule, AchievementModule],
  controllers: [RankController],
  providers: [RankService],
  exports: [RankService],
})
export class RankModule {}
