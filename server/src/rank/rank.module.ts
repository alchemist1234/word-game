import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserEntity } from '../user/user.entity'
import { MatchPlayerEntity } from '../match/match-player.entity'
import { LeaderboardSnapshotEntity } from '../leaderboard/leaderboard-snapshot.entity'
import { RankService } from './rank.service'
import { RankController } from './rank.controller'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, MatchPlayerEntity, LeaderboardSnapshotEntity]), AuthModule],
  controllers: [RankController],
  providers: [RankService],
  exports: [RankService],
})
export class RankModule {}
