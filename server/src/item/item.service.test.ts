jest.mock('uuid', () => ({ v4: () => 'test-uuid' }))

import type Redis from 'ioredis'
import type { DataSource, Repository } from 'typeorm'
import { ItemService } from './item.service'
import type { UserItemEntity } from './user-item.entity'
import type { UserEntity } from '../user/user.entity'
import type { GridPoolService } from '../grid-pool/grid-pool.service'
import type { DictionaryService } from '../dictionary/dictionary.service'

function createService(session: Record<string, string> = {}): ItemService {
  const itemRepo = {
    findOne: jest.fn(async () => null),
    save: jest.fn(async (value: UserItemEntity) => value),
  } as unknown as Repository<UserItemEntity>
  const userRepo = {
    findOne: jest.fn(async () => ({ id: 1, coins: 1000, diamonds: 1000 })),
    save: jest.fn(async (value: UserEntity) => value),
  } as unknown as Repository<UserEntity>
  const redis = {
    hgetall: jest.fn(async () => session),
    set: jest.fn(async () => 'OK'),
    incr: jest.fn(async () => 1),
    decr: jest.fn(async () => 0),
    expire: jest.fn(async () => 1),
    eval: jest.fn(async () => 1),
    smembers: jest.fn(async () => []),
    hset: jest.fn(async () => 1),
    del: jest.fn(async () => 1),
  } as unknown as Redis
  return new ItemService(
    itemRepo,
    userRepo,
    {} as DataSource,
    redis,
    {} as GridPoolService,
    {} as DictionaryService,
  )
}

describe('ItemService configuration and mode guards', () => {
  it('registers exactly the five supported effects', () => {
    const items = createService().getItems()
    expect(items).toHaveLength(5)
    expect(new Set(items.map((item) => item.id))).toEqual(new Set(['hint', 'shuffle', 'freeze', 'double', 'peek']))
    expect(items.find((item) => item.id === 'peek')?.bossOnly).toBe(true)
  })

  it('rejects shuffle in daily mode before charging', async () => {
    const service = createService({
      userId: '1',
      grid: '[["中"]]',
      isDailyMode: '1',
      startedAt: String(Date.now()),
      duration: '180',
      deadlineAt: String(Date.now() + 180000),
    })
    await expect(service.useItem(1, 'session-1', 'shuffle')).rejects.toMatchObject({ message: '该道具在此模式不可用' })
  })
})
