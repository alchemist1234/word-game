import { Module } from '@nestjs/common'
import { join } from 'path'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ScheduleModule } from '@nestjs/schedule'
import { config } from './common/config'
import { RedisModule } from './common/redis.module'
import { DictionaryEntity } from './dictionary/dictionary.entity'
import { GridPoolEntity } from './grid-pool/grid-pool.entity'
import { UserEntity } from './user/user.entity'
import { UserAuthEntity } from './user/user-auth.entity'
import { UserProgressEntity } from './user/user-progress.entity'
import { UserFoundWordEntity } from './user/user-found-word.entity'
import { MatchEntity } from './match/match.entity'
import { MatchPlayerEntity } from './match/match-player.entity'
import { ChallengeEntity } from './challenge/challenge.entity'
import { ChallengeAttemptEntity } from './challenge/challenge-attempt.entity'
import { DailyChallengeEntity } from './daily/daily-challenge.entity'
import { DailyRewardClaimEntity } from './daily/daily-reward-claim.entity'
import { DailyAttemptEntity } from './daily/daily-attempt.entity'
import { LeaderboardSnapshotEntity } from './leaderboard/leaderboard-snapshot.entity'
import { DictionaryModule } from './dictionary/dictionary.module'
import { GridPoolModule } from './grid-pool/grid-pool.module'
import { GameModule } from './game/game.module'
import { AuthModule } from './auth/auth.module'
import { LevelModule } from './level/level.module'
import { PokedexModule } from './pokedex/pokedex.module'
import { MatchModule } from './match/match.module'
import { ChallengeModule } from './challenge/challenge.module'
import { DailyModule } from './daily/daily.module'
import { LeaderboardModule } from './leaderboard/leaderboard.module'
import { EconomyModule } from './economy/economy.module'
import { RankModule } from './rank/rank.module'
import { AiModule } from './ai/ai.module'
import { ItemModule } from './item/item.module'
import { AchievementModule } from './achievement/achievement.module'
import { WordApplyModule } from './word-apply/word-apply.module'
import { UserItemEntity } from './item/user-item.entity'
import { UserAchievementEntity } from './achievement/user-achievement.entity'
import { WordApplyEntity } from './word-apply/word-apply.entity'
import { GameSettlementEntity } from './game/game-settlement.entity'
import { OutboxEventEntity } from './outbox/outbox-event.entity'
import { SeasonSettlementEntity } from './rank/season-settlement.entity'
import { OutboxModule } from './outbox/outbox.module'
import { HealthModule } from './health/health.module'

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: config.db.host,
      port: config.db.port,
      username: config.db.username,
      password: config.db.password,
      database: config.db.database,
      entities: [
        DictionaryEntity,
        GridPoolEntity,
        UserEntity,
        UserAuthEntity,
        UserProgressEntity,
        UserFoundWordEntity,
        MatchEntity,
        MatchPlayerEntity,
        ChallengeEntity,
        ChallengeAttemptEntity,
        DailyChallengeEntity,
        DailyAttemptEntity,
        DailyRewardClaimEntity,
        LeaderboardSnapshotEntity,
        UserItemEntity,
        UserAchievementEntity,
        WordApplyEntity,
        GameSettlementEntity,
        OutboxEventEntity,
        SeasonSettlementEntity,
      ],
      synchronize: config.db.synchronize,
      migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
      migrationsRun: config.db.migrationsRun,
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    DictionaryModule,
    GridPoolModule,
    GameModule,
    AuthModule,
    LevelModule,
    PokedexModule,
    MatchModule,
    ChallengeModule,
    DailyModule,
    LeaderboardModule,
    EconomyModule,
    RankModule,
    AiModule,
    ItemModule,
    AchievementModule,
    WordApplyModule,
    OutboxModule,
    HealthModule,
  ],
})
export class AppModule {}
