import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common'
import Redis from 'ioredis'
import { config } from './config'

export const REDIS_TOKEN = 'REDIS'

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS_TOKEN) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit()
    } catch {
      this.redis.disconnect()
    }
  }
}

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
          password: config.redis.password,
          keyPrefix: config.redis.keyPrefix || undefined,
          maxRetriesPerRequest: 3,
        }),
    },
    RedisLifecycle,
  ],
  exports: [REDIS_TOKEN],
})
export class RedisModule {}
