import { Inject, Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, EntityManager, Repository } from 'typeorm'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { OutboxEventEntity } from './outbox-event.entity'
import { AchievementService } from '../achievement/achievement.service'
import { UPDATE_LEADERBOARD_SCRIPT } from '../game/redis-scripts'
import { FaultInjectionService } from '../common/fault-injection.service'
import { REDIS_TOKEN } from '../common/redis.module'
import type { GameEndResult } from '../game/game.service'

const MAX_BACKOFF_MS = 60 * 60 * 1000

interface SettlementPayload {
  userId: number
  result: GameEndResult
}

function isSettlementPayload(value: unknown): value is SettlementPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as { userId?: unknown; result?: unknown }
  if (!Number.isInteger(payload.userId) || (payload.userId as number) <= 0) return false
  if (!payload.result || typeof payload.result !== 'object') return false
  const result = payload.result as Partial<GameEndResult>
  return typeof result.score === 'number' && Array.isArray(result.foundWords)
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name)
  private readonly workerId = `outbox-${process.pid}-${uuidv4().slice(0, 8)}`

  constructor(
    @InjectRepository(OutboxEventEntity)
    private readonly outboxRepo: Repository<OutboxEventEntity>,
    private readonly dataSource: DataSource,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    private readonly achievementService: AchievementService,
    private readonly faultInjection: FaultInjectionService,
  ) {}

  /** 在调用方的 PostgreSQL 事务中写入事件；dedupe_key 保证重复结算不重复入队。 */
  async enqueueSettlementEffects(
    manager: EntityManager,
    matchSessionId: string,
    userId: number,
    result: GameEndResult,
  ): Promise<void> {
    if (userId <= 0) return
    await manager.query(
      `INSERT INTO outbox_events
         (id, "eventType", "aggregateType", "aggregateId", "dedupeKey", payload, "availableAt")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
       ON CONFLICT ("dedupeKey") DO NOTHING`,
      [
        uuidv4(),
        'settlement.post_effects',
        'game_settlement',
        matchSessionId,
        `settlement:${matchSessionId}:post_effects`,
        JSON.stringify({ userId, result }),
      ],
    )
  }

  /** 兼容旧结算记录/缓存命中：事务外补写同一 dedupe 事件。 */
  async ensureSettlementEffects(
    matchSessionId: string,
    userId: number,
    result: GameEndResult,
  ): Promise<void> {
    if (userId <= 0) return
    await this.dataSource.query(
      `INSERT INTO outbox_events
         (id, "eventType", "aggregateType", "aggregateId", "dedupeKey", payload, "availableAt")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
       ON CONFLICT ("dedupeKey") DO NOTHING`,
      [
        uuidv4(),
        'settlement.post_effects',
        'game_settlement',
        matchSessionId,
        `settlement:${matchSessionId}:post_effects`,
        JSON.stringify({ userId, result }),
      ],
    )
  }

  @Interval(5000)
  async processPending(limit = 20): Promise<void> {
    const events = await this.claim(limit)
    for (const event of events) {
      await this.processOne(event)
    }
  }

  /** 请求线程可主动触发一次低延迟消费；失败不影响结算主流程。 */
  async dispatchNow(limit = 5): Promise<void> {
    try {
      await this.processPending(limit)
    } catch (error) {
      this.logger.warn(`outbox immediate dispatch failed: ${(error as Error).message}`)
    }
  }

  private async claim(limit: number): Promise<OutboxEventEntity[]> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OutboxEventEntity)
      const events = await repo
        .createQueryBuilder('event')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('event.processedAt IS NULL')
        .andWhere('event.availableAt <= NOW()')
        .andWhere(
          '(event.lockedAt IS NULL OR event.lockedAt < NOW() - INTERVAL \'5 minutes\')',
        )
        .orderBy('event.createdAt', 'ASC')
        .limit(limit)
        .getMany()
      const now = new Date()
      for (const event of events) {
        await repo.update(
          { id: event.id },
          { lockedAt: now, lockedBy: this.workerId },
        )
        event.lockedAt = now
        event.lockedBy = this.workerId
      }
      return events
    })
  }

  private async processOne(event: OutboxEventEntity): Promise<void> {
    try {
      await this.faultInjection.trigger('after_outbox_claim_before_effect')
      await this.handle(event)
      await this.faultInjection.trigger('after_effect_before_outbox_ack')
      await this.outboxRepo.update(
        { id: event.id },
        { processedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const attempts = event.attempts + 1
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempts, 10))
      await this.outboxRepo.update(
        { id: event.id },
        {
          attempts,
          availableAt: new Date(Date.now() + delay),
          lockedAt: null,
          lockedBy: null,
          lastError: message.slice(0, 2000),
        },
      )
      this.logger.warn(
        `outbox event ${event.id} failed (attempt ${attempts}): ${message}`,
      )
    }
  }

  private async handle(event: OutboxEventEntity): Promise<void> {
    if (event.eventType !== 'settlement.post_effects') {
      throw new Error(`unsupported outbox event: ${event.eventType}`)
    }
    if (!isSettlementPayload(event.payload)) {
      throw new Error('invalid settlement outbox payload')
    }
    const { userId, result } = event.payload
    await this.redis.eval(
      UPDATE_LEADERBOARD_SCRIPT,
      1,
      'lb:all',
      userId.toString(),
      result.score.toString(),
    )
    if (result.maxCombo >= 5) {
      await this.achievementService.check(userId, 'maxCombo', {
        maxCombo: result.maxCombo,
      })
    }
    if (result.foundWords.some((word) => word.rarity === 'idiom')) {
      await this.achievementService.check(userId, 'word_found', { rarity: 'idiom' })
    }
    await this.achievementService.check(userId, 'pokedex', {})
  }
}
