import { Injectable, OnModuleInit, Inject } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { GridPoolEntity } from './grid-pool.entity'
import { DictionaryService } from '../dictionary/dictionary.service'
import { generateGrid } from '../grid-gen/grid-gen'
import { Trie } from '../grid-gen/trie'
import type { DictWord } from '../grid-gen/types'
import { REDIS_TOKEN } from '../common/redis.module'

const POOL_THRESHOLD = 20
const DIFFICULTIES = ['easy', 'standard', 'hard'] as const

/**
 * 网格池服务：预生成 + Redis 取用 + PG 持久化 + cron 补充
 * 对齐迭代2详细设计 §6.4
 */
@Injectable()
export class GridPoolService implements OnModuleInit {
  private dictWords: DictWord[] = []
  private trie: Trie | null = null

  constructor(
    @InjectRepository(GridPoolEntity)
    private readonly repo: Repository<GridPoolEntity>,
    private readonly dictionaryService: DictionaryService,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    const { words, trie } = await this.dictionaryService.loadAll()
    this.dictWords = words
    this.trie = trie
    await this.replenishIfNeeded()
  }

  /** 取一张可用网格（LPOP Redis，标记 PG used） */
  async acquire(difficulty: string): Promise<GridPoolEntity | null> {
    const id = await this.redis.lpop(`grid_pool:${difficulty}`)
    if (!id) return null
    const grid = await this.repo.findOne({ where: { id } })
    if (grid) {
      grid.status = 'used'
      await this.repo.save(grid)
    }
    return grid
  }

  async findById(id: string): Promise<GridPoolEntity | null> {
    return this.repo.findOne({ where: { id } })
  }

  /** 定时补充（每 10 分钟） */
  @Cron('*/10 * * * *')
  async cronReplenish(): Promise<void> {
    await this.replenishIfNeeded()
  }

  async replenishIfNeeded(): Promise<void> {
    if (!this.trie) return
    for (const diff of DIFFICULTIES) {
      const count = await this.redis.llen(`grid_pool:${diff}`)
      if (count < POOL_THRESHOLD) {
        const need = POOL_THRESHOLD - count
        for (let i = 0; i < need; i++) {
          await this.generateAndStore(diff)
        }
      }
    }
  }

  private async generateAndStore(difficulty: string): Promise<void> {
    if (!this.trie) return
    const generated = generateGrid(difficulty, this.dictWords, this.trie)
    const entity = this.repo.create({
      id: uuidv4(),
      size: generated.size,
      difficulty,
      grid: generated.grid,
      targetWords: generated.targetWords,
      potentialCount: generated.potentialCount,
      potentialWords: generated.potentialWords,
      status: 'available',
    })
    await this.repo.save(entity)
    await this.redis.rpush(`grid_pool:${difficulty}`, entity.id)
  }
}
