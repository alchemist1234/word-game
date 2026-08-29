import { Module } from '@nestjs/common'
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
import { DictionaryModule } from './dictionary/dictionary.module'
import { GridPoolModule } from './grid-pool/grid-pool.module'
import { GameModule } from './game/game.module'
import { AuthModule } from './auth/auth.module'
import { LevelModule } from './level/level.module'
import { PokedexModule } from './pokedex/pokedex.module'
import { MatchModule } from './match/match.module'

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
      ],
      synchronize: true,
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
  ],
})
export class AppModule {}
