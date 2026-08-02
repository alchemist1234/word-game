import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ScheduleModule } from '@nestjs/schedule'
import { config } from './common/config'
import { RedisModule } from './common/redis.module'
import { DictionaryEntity } from './dictionary/dictionary.entity'
import { GridPoolEntity } from './grid-pool/grid-pool.entity'
import { DictionaryModule } from './dictionary/dictionary.module'
import { GridPoolModule } from './grid-pool/grid-pool.module'
import { GameModule } from './game/game.module'

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: config.db.host,
      port: config.db.port,
      username: config.db.username,
      password: config.db.password,
      database: config.db.database,
      entities: [DictionaryEntity, GridPoolEntity],
      synchronize: true, // 开发期自动建表，生产用迁移
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    DictionaryModule,
    GridPoolModule,
    GameModule,
  ],
})
export class AppModule {}
