import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import Redis from 'ioredis'
import { REDIS_TOKEN } from '../common/redis.module'

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
  ) {}

  @Get('live')
  live() {
    return { ok: true }
  }

  @Get('ready')
  async ready() {
    try {
      await this.dataSource.query('SELECT 1')
      await this.redis.ping()
      return { ok: true, postgres: true, redis: true }
    } catch {
      throw new ServiceUnavailableException('dependency not ready')
    }
  }
}
