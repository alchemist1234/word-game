import type { DataSource, EntityManager, Repository } from 'typeorm'
import type Redis from 'ioredis'
import { WordApplyService } from './word-apply.service'
import type { WordApplyEntity } from './word-apply.entity'
import type { DictionaryEntity } from '../dictionary/dictionary.entity'
import type { DictionaryService } from '../dictionary/dictionary.service'

function makeService(): {
  service: WordApplyService
  rows: WordApplyEntity[]
  dictionaryRows: DictionaryEntity[]
  redisValues: Map<string, number>
} {
  const rows: WordApplyEntity[] = []
  const dictionaryRows: DictionaryEntity[] = []
  const redisValues = new Map<string, number>()
  const applyRepo = {
    findOne: jest.fn(async ({ where }: { where: { word: string; userId: number } }) =>
      rows.find((row) => row.word === where.word && row.userId === where.userId) ?? null,
    ),
    count: jest.fn(async ({ where }: { where: { word?: string; userId?: number; status?: string } }) =>
      rows.filter((row) =>
        (where.word === undefined || row.word === where.word) &&
        (where.userId === undefined || row.userId === where.userId) &&
        (where.status === undefined || row.status === where.status),
      ).length,
    ),
    create: jest.fn((value: Partial<WordApplyEntity>) => value as WordApplyEntity),
    save: jest.fn(async (value: WordApplyEntity) => {
      const existingIndex = rows.findIndex((row) => row.word === value.word && row.userId === value.userId)
      if (existingIndex >= 0) rows[existingIndex] = value
      else rows.push(value)
      return value
    }),
  } as unknown as Repository<WordApplyEntity>
  const dictRepo = {
    findOne: jest.fn(async ({ where }: { where: { word: string } }) =>
      dictionaryRows.find((row) => row.word === where.word) ?? null,
    ),
  } as unknown as Repository<DictionaryEntity>
  const dictionaryService = {
    findByWord: jest.fn((word: string) => null),
    refresh: jest.fn(async () => undefined),
  } as unknown as DictionaryService
  const redis = {
    hgetall: jest.fn(async () => ({})),
    incr: jest.fn(async (key: string) => {
      const value = (redisValues.get(key) ?? 0) + 1
      redisValues.set(key, value)
      return value
    }),
    decr: jest.fn(async (key: string) => {
      const value = Math.max(0, (redisValues.get(key) ?? 0) - 1)
      redisValues.set(key, value)
      return value
    }),
    expire: jest.fn(async () => 1),
  } as unknown as Redis
  const txRepo = applyRepo
  const manager = {
    getRepository: jest.fn(() => txRepo),
  } as unknown as EntityManager
  const dataSource = {
    transaction: jest.fn(async (callback: (value: EntityManager) => Promise<unknown>) => callback(manager)),
  } as unknown as DataSource
  const service = new WordApplyService(applyRepo, dictRepo, dictionaryService, redis, dataSource)
  return { service, rows, dictionaryRows, redisValues }
}

describe('WordApplyService P1 safety', () => {
  it('rejects blocked words before touching the database', async () => {
    const { service, rows } = makeService()
    await expect(service.apply(1, '加微信')).rejects.toMatchObject({ message: 'WORD_BLOCKED' })
    expect(rows).toHaveLength(0)
  })

  it('keeps the first application pending when auto merge is disabled', async () => {
    const { service, rows, dictionaryRows } = makeService()
    const result = await service.apply(1, '测试词')
    expect(result).toMatchObject({ applied: true, status: 'pending', autoMerged: false, supporters: 1 })
    expect(rows).toHaveLength(1)
    expect(dictionaryRows).toHaveLength(0)
  })

  it('is idempotent for the same user and word', async () => {
    const { service, rows } = makeService()
    await service.apply(1, '测试词')
    const second = await service.apply(1, '测试词')
    expect(second).toMatchObject({ applied: false, alreadyApplied: true, supporters: 1 })
    expect(rows).toHaveLength(1)
  })
})
