jest.mock('uuid', () => ({ v4: () => 'test-uuid' }))

import { ForbiddenException } from '@nestjs/common'
import type Redis from 'ioredis'
import type { DataSource, EntityManager, Repository } from 'typeorm'
import { GameService, type GameEndResult } from './game.service'
import type { GridPoolService } from '../grid-pool/grid-pool.service'
import type { DictionaryService } from '../dictionary/dictionary.service'
import type { GameSettlementEntity } from './game-settlement.entity'
import {
  ASSERT_END_LOCK_SCRIPT,
  COMMIT_SETTLEMENT_SCRIPT,
  FINALIZE_CACHED_SETTLEMENT_SCRIPT,
} from './redis-scripts'

interface MultiChainMock {
  set: (key: string, value: string, ...args: Array<string | number>) => MultiChainMock
  hset: (key: string, field: string, value: string) => MultiChainMock
  hdel: (key: string, ...fields: string[]) => MultiChainMock
  exec: () => Promise<Array<Array<string | number | null>>>
}

function createService(
  redis: Redis,
  settlementRepo: Repository<GameSettlementEntity> = {} as Repository<GameSettlementEntity>,
  dataSource: DataSource = {} as DataSource,
): GameService {
  const gridPoolService = {} as GridPoolService
  const dictionaryService = {
    findByWord: () => null,
  } as unknown as DictionaryService
  return new GameService(
    gridPoolService,
    dictionaryService,
    redis,
    settlementRepo,
    dataSource,
  )
}

describe('GameService authority guards', () => {
  it('拒绝使用其他用户的对局 session', async () => {
    const session = {
      userId: '1',
      grid: '[["中","国"],["朋","友"]]',
      potentialWords: '["中国"]',
      potentialWordsWithRarity: JSON.stringify([
        { word: '中国', rarity: 'common', length: 2 },
      ]),
    }
    const redis = {
      hgetall: jest.fn(async (_key: string) => session),
    } as unknown as Redis
    const service = createService(redis)

    await expect(
      service.submitWord(2, 'session-1', '中国', [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('服务端截止时间到达后拒绝继续提词', async () => {
    const session = {
      userId: '1',
      grid: '[["中","国"],["朋","友"]]',
      potentialWords: '["中国"]',
      potentialWordsWithRarity: JSON.stringify([
        { word: '中国', rarity: 'common', length: 2 },
      ]),
      deadlineAt: String(Date.now() - 1000),
    }
    const redis = {
      hgetall: jest.fn(async (_key: string) => session),
      eval: jest.fn(async () => ['expired']),
    } as unknown as Redis
    const service = createService(redis)

    await expect(
      service.submitWord(1, 'session-1', '中国', [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
      ]),
    ).resolves.toEqual({ valid: false, reason: 'game_expired' })
    expect(redis.eval).toHaveBeenCalled()
  })

  it('首次结算写入缓存，第二次不重复写图鉴', async () => {
    const session = {
      userId: '1',
      grid: '[["中","国"],["朋","友"]]',
      potentialWords: '["中国"]',
      potentialWordsWithRarity: JSON.stringify([
        { word: '中国', rarity: 'common', length: 2 },
      ]),
      potentialCount: '1',
      score: '2',
      comboScore: '0',
      maxCombo: '0',
      isPerfect: '0',
      perfectBonus: '0',
    }
    let resultCache: string | null = null
    let settlement: GameSettlementEntity | null = null
    const multi: MultiChainMock = {
      set: jest.fn((_key: string, value: string) => {
        resultCache = value
        return multi
      }),
      hset: jest.fn(() => multi),
      hdel: jest.fn(() => multi),
      exec: jest.fn(async () => [[null, 'OK'], [null, 1], [null, 1]]),
    }
    const redis = {
      hgetall: jest.fn(async (_key: string) => session),
      get: jest.fn(async (_key: string) => resultCache),
      set: jest.fn(async (_key: string) => 'OK'),
      hset: jest.fn(async (_key: string, _fields: Record<string, string>) => 1),
      smembers: jest.fn(async (_key: string) => ['中国']),
      zscore: jest.fn(async (_key: string, _member: string) => null),
      zadd: jest.fn(async (_key: string, _score: string, _member: string) => 1),
      eval: jest.fn(async (script: string) => {
        if (script === ASSERT_END_LOCK_SCRIPT) return 1
        if (script === COMMIT_SETTLEMENT_SCRIPT) return ['ok']
        return 1
      }),
      multi: jest.fn(() => multi),
    } as unknown as Redis
    const settlementRepo = {
      findOne: jest.fn(async () => settlement),
    } as unknown as Repository<GameSettlementEntity>
    const manager = {
      findOne: jest.fn(async () => settlement),
      query: jest.fn(async () => undefined),
      create: jest.fn((_entity: unknown, value: GameSettlementEntity) => value),
      save: jest.fn(async (value: GameSettlementEntity) => {
        settlement = value
        return value
      }),
    } as unknown as EntityManager
    type TransactionCallback = (transactionManager: EntityManager) => Promise<GameEndResult>
    const dataSource = {
      transaction: jest.fn(async (callback: TransactionCallback) => callback(manager)),
    } as unknown as DataSource
    const service = createService(redis, settlementRepo, dataSource)

    const first = await service.endGame(1, 'session-1')
    const second = await service.endGame(1, 'session-1')

    expect(second).toEqual(first)
    expect(manager.query).toHaveBeenCalledTimes(1)
  })

  it('重复结算直接返回缓存结果，不重复执行副作用', async () => {
    const session = {
      userId: '1',
      grid: '[["中","国"]]',
    }
    const cached: GameEndResult = {
      score: 2,
      comboScore: 0,
      maxCombo: 0,
      potentialCount: 1,
      perfect: false,
      perfectBonus: 0,
      foundWords: [{ word: '中国', score: 2, rarity: 'common' }],
      unfoundWords: [],
    }
    const cachedMulti: MultiChainMock = {
      set: jest.fn(() => cachedMulti),
      hset: jest.fn(() => cachedMulti),
      hdel: jest.fn(() => cachedMulti),
      exec: jest.fn(async () => [[null, 1], [null, 1]]),
    }
    const redis = {
      hgetall: jest.fn(async (_key: string) => session),
      get: jest.fn(async (_key: string) => JSON.stringify(cached)),
      zscore: jest.fn(async (_key: string, _member: string) => null),
      zadd: jest.fn(async (_key: string, _score: string, _member: string) => 1),
      eval: jest.fn(async (script: string) => {
        if (script === FINALIZE_CACHED_SETTLEMENT_SCRIPT) return ['ok']
        return 1
      }),
      multi: jest.fn(() => cachedMulti),
    } as unknown as Redis
    const service = createService(redis)

    await expect(service.endGame(1, 'session-1')).resolves.toEqual(cached)
    expect(redis.get).toHaveBeenCalledWith('match_session:session-1:result')
  })
})
