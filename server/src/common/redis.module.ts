import { Global, Module } from '@nestjs/common'
import Redis from 'ioredis'
import { config } from './config'

export const REDIS_TOKEN = 'REDIS'

/** 全局 Redis provider（ioredis 实例） */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_TOKEN,
      useFactory: () =>
        new Redis({
          host: config.redis.host,
          port: config.redis.port,
          maxRetriesPerRequest: 3,
        }),
    },
  ],
  exports: [REDIS_TOKEN],
})
export class RedisModule {}
