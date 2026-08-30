import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { LeaderboardService } from './leaderboard.service'
import { LeaderboardController } from './leaderboard.controller'
import { LeaderboardSnapshotEntity } from './leaderboard-snapshot.entity'
import { UserEntity } from '../user/user.entity'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([LeaderboardSnapshotEntity, UserEntity])],
  controllers: [LeaderboardController],
  providers: [LeaderboardService],
  exports: [LeaderboardService],
})
export class LeaderboardModule {}
