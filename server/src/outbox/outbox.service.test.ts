jest.mock('uuid', () => ({ v4: () => 'test-uuid' }))

import type { DataSource, EntityManager, Repository } from 'typeorm'
import type Redis from 'ioredis'
import { OutboxService } from './outbox.service'
import type { OutboxEventEntity } from './outbox-event.entity'
import type { AchievementService } from '../achievement/achievement.service'
import { FaultInjectionService } from '../common/fault-injection.service'
import type { GameEndResult } from '../game/game.service'

const result: GameEndResult = {
  score: 12,
  comboScore: 0,
  maxCombo: 2,
  potentialCount: 3,
  perfect: false,
  perfectBonus: 0,
  foundWords: [],
  unfoundWords: [],
}

describe('OutboxService', () => {
  it('writes a settlement event with the schema column names inside the caller transaction', async () => {
    const query = jest.fn(async () => undefined)
    const manager = { query } as unknown as EntityManager
    const dataSource = { query: jest.fn(async () => undefined) } as unknown as DataSource
    const redis = { eval: jest.fn(async () => 1) } as unknown as Redis
    const achievements = { check: jest.fn(async () => undefined) } as unknown as AchievementService
    const service = new OutboxService(
      {} as Repository<OutboxEventEntity>,
      dataSource,
      redis,
      achievements,
      new FaultInjectionService(),
    )

    await service.enqueueSettlementEffects(manager, 'session-1', 7, result)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('"eventType"'),
      expect.arrayContaining(['session-1', 'settlement:session-1:post_effects']),
    )
  })

  it('supports an explicit test-only fault point without exposing an HTTP endpoint', async () => {
    const previous = process.env.FAULT_INJECTION_POINTS
    process.env.FAULT_INJECTION_POINTS = 'after_effect_before_outbox_ack'
    const service = new FaultInjectionService()
    await expect(service.trigger('after_effect_before_outbox_ack')).rejects.toThrow('fault injection')
    if (previous === undefined) delete process.env.FAULT_INJECTION_POINTS
    else process.env.FAULT_INJECTION_POINTS = previous
  })
})
