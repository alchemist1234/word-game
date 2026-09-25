import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
} from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, EntityManager, Repository } from 'typeorm'
import Redis from 'ioredis'
import { REDIS_TOKEN } from '../common/redis.module'
import { config } from '../common/config'
import { cstDateStr } from '../common/time'
import { WordApplyEntity } from './word-apply.entity'
import { DictionaryEntity } from '../dictionary/dictionary.entity'
import { DictionaryService } from '../dictionary/dictionary.service'
import { validatePath } from '../game/check'
import type { CellPos } from '../grid-gen/types'
import sensitiveWords from '../../data/sensitive-words.json'

const WORD_RE = /^[\u4e00-\u9fff]{2,6}$/
const PENDING = 'pending'
const AUTO_MERGED = 'auto_merged'
const BLOCKED_WORDS = new Set((sensitiveWords as string[]).map((word) => word.trim()))

export interface ApplyResult {
  applied: boolean
  alreadyApplied?: boolean
  inDict?: boolean
  supporters: number
  threshold: number
  status: string
  autoMerged: boolean
  reviewRequired?: boolean
}

@Injectable()
export class WordApplyService {
  private readonly logger = new Logger(WordApplyService.name)

  constructor(
    @InjectRepository(WordApplyEntity)
    private readonly applyRepo: Repository<WordApplyEntity>,
    @InjectRepository(DictionaryEntity)
    private readonly dictRepo: Repository<DictionaryEntity>,
    private readonly dictionaryService: DictionaryService,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  private get threshold(): number {
    return config.wordApply.threshold
  }

  private get dailyLimit(): number {
    return config.wordApply.dailyLimit
  }

  private get autoMergeEnabled(): boolean {
    return config.wordApply.autoMergeEnabled
  }

  private assertSafeWord(word: string): void {
    if (BLOCKED_WORDS.has(word) || [...BLOCKED_WORDS].some((blocked) => word.includes(blocked))) {
      throw new BadRequestException('WORD_BLOCKED')
    }
  }

  private async reserveDailySlot(userId: number): Promise<string> {
    const day = cstDateStr().replace(/-/g, '')
    const key = `word_apply_daily:${userId}:${day}`
    const count = await this.redis.incr(key)
    if (count === 1) await this.redis.expire(key, 2 * 24 * 60 * 60)
    if (count > this.dailyLimit) {
      await this.redis.decr(key)
      throw new BadRequestException('DAILY_LIMIT')
    }
    return key
  }

  private async releaseDailySlot(key: string): Promise<void> {
    try {
      await this.redis.decr(key)
    } catch (error) {
      this.logger.warn(`release word apply daily slot failed: ${(error as Error).message}`)
    }
  }

  /** 申请收录（幂等：一人一票；审核能力不足时默认只保留 pending）。 */
  async apply(
    userId: number,
    rawWord: string,
    matchSessionId?: string,
    cells?: CellPos[],
  ): Promise<ApplyResult> {
    if (typeof rawWord !== 'string') {
      throw new BadRequestException('WORD_INVALID')
    }
    const word = rawWord.trim()
    if (!WORD_RE.test(word)) {
      throw new BadRequestException('WORD_INVALID')
    }
    this.assertSafeWord(word)

    // 已在库：不计数，直接告知。内存缓存未命中时再查一次 PG，兼容多实例刷新延迟。
    const inMemory = this.dictionaryService.findByWord(word)
    const inDb = inMemory ? null : await this.dictRepo.findOne({ where: { word } })
    if (inMemory || inDb) {
      return {
        applied: false,
        inDict: true,
        supporters: 0,
        threshold: this.threshold,
        status: 'in_dict',
        autoMerged: false,
      }
    }

    // 路径证据校验（game 来源）
    let source = 'manual'
    let gridSeed: string | null = null
    let cellsJson: Array<{ row: number; col: number }> | null = null
    if (matchSessionId) {
      const session = await this.redis.hgetall(`match_session:${matchSessionId}`)
      if (!session || !session.grid) {
        throw new NotFoundException('对局会话不存在或已过期，可直接提交文字申请')
      }
      if (session.userId !== userId.toString()) {
        throw new ForbiddenException('会话不属于当前用户')
      }
      if (cells !== undefined && !Array.isArray(cells)) {
        throw new BadRequestException('EVIDENCE_INVALID')
      }
      const path = (cells ?? []).map((cell) => {
        if (!cell || typeof cell !== 'object') {
          throw new BadRequestException('EVIDENCE_INVALID')
        }
        const value = cell as { row?: unknown; col?: unknown }
        if (!Number.isInteger(value.row) || !Number.isInteger(value.col)) {
          throw new BadRequestException('EVIDENCE_INVALID')
        }
        return { row: value.row as number, col: value.col as number }
      })
      if (path.length < 2) {
        throw new BadRequestException('EVIDENCE_INVALID')
      }
      let grid: string[][] = []
      try {
        const parsed: unknown = JSON.parse(session.grid)
        if (
          !Array.isArray(parsed) ||
          parsed.length === 0 ||
          parsed.some(
            (row) =>
              !Array.isArray(row) ||
              row.length !== parsed.length ||
              row.some((cell) => typeof cell !== 'string'),
          )
        ) {
          throw new Error('invalid grid')
        }
        grid = parsed as string[][]
      } catch {
        throw new BadRequestException('EVIDENCE_INVALID')
      }
      const pathResult = validatePath(path, grid.length)
      if (!pathResult.valid) {
        throw new BadRequestException('EVIDENCE_INVALID')
      }
      const gridChars = path.map((c) => grid[c.row]?.[c.col] ?? '').join('')
      if (gridChars !== word) {
        throw new BadRequestException('EVIDENCE_INVALID')
      }
      source = 'game'
      gridSeed = session.gridUuid ?? null
      cellsJson = path
    }

    // Redis 原子日限，避免多实例并发绕过 users/word_applies 的 count 检查。
    const dailyKey = await this.reserveDailySlot(userId)
    try {
      let merged = false
      const result: ApplyResult = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(WordApplyEntity)
        const existing = await repo.findOne({ where: { word, userId } })
        if (existing) {
          existing.updatedAt = new Date()
          await repo.save(existing)
          const supporters = await this.countSupporters(word, repo)
          if (this.autoMergeEnabled && supporters >= this.threshold && existing.status === PENDING) {
            await this.tryAutoMergeWithManager(manager, word)
            merged = true
            return {
              applied: false,
              alreadyApplied: true,
              supporters,
              threshold: this.threshold,
              status: AUTO_MERGED,
              autoMerged: true,
              reviewRequired: false,
            }
          }
          return {
            applied: false,
            alreadyApplied: true,
            supporters,
            threshold: this.threshold,
            status: existing.status,
            autoMerged: false,
            reviewRequired: existing.status === PENDING,
          }
        }

        const entity = repo.create({
          word,
          userId,
          status: PENDING,
          source,
          matchSessionId: matchSessionId ?? null,
          cells: cellsJson,
          gridSeed,
        })
        await repo.save(entity)
        const supporters = await this.countSupporters(word, repo)
        if (this.autoMergeEnabled && supporters >= this.threshold) {
          await this.tryAutoMergeWithManager(manager, word)
          merged = true
          return {
            applied: true,
            supporters,
            threshold: this.threshold,
            status: AUTO_MERGED,
            autoMerged: true,
            reviewRequired: false,
          }
        }
        return {
          applied: true,
          supporters,
          threshold: this.threshold,
          status: PENDING,
          autoMerged: false,
          reviewRequired: true,
        }
      })

      if (merged) {
        try {
          await this.dictionaryService.refresh()
        } catch (error) {
          // DB 已提交；缓存刷新失败由新会话/重启恢复，不回滚已成功的申请事务。
          this.logger.error(`dictionary refresh after auto merge failed: ${(error as Error).message}`)
        }
      }
      return result
    } catch (error) {
      await this.releaseDailySlot(dailyKey)
      throw error
    }
  }

  /** 我的申请（含每词支持数，一次 GROUP BY 补齐） */
  async mine(userId: number): Promise<{
    threshold: number
    list: Array<{
      word: string
      status: string
      supporters: number
      createdAt: Date
    }>
  }> {
    const rows = await this.applyRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    })
    const supportersMap = await this.supportersMap(rows.map((r) => r.word))
    return {
      threshold: this.threshold,
      list: rows.map((r) => ({
        word: r.word,
        status: r.status,
        supporters: supportersMap.get(r.word) ?? 0,
        createdAt: r.createdAt,
      })),
    }
  }

  /** 单词支持数（含是否在库、本人是否已申请） */
  async supporters(
    word: string,
    userId: number,
  ): Promise<{
    word: string
    supporters: number
    threshold: number
    inDict: boolean
    appliedByMe: boolean
  }> {
    if (typeof word !== 'string') {
      throw new BadRequestException('WORD_INVALID')
    }
    const w = word.trim()
    if (!WORD_RE.test(w)) {
      throw new BadRequestException('WORD_INVALID')
    }
    const inMemory = this.dictionaryService.findByWord(w)
    const inDb = inMemory ? null : await this.dictRepo.findOne({ where: { word: w } })
    const inDict = !!inMemory || !!inDb
    const supporters = await this.countSupporters(w)
    const mine = await this.applyRepo.findOne({ where: { word: w, userId } })
    return {
      word: w,
      supporters,
      threshold: this.threshold,
      inDict,
      appliedByMe: !!mine,
    }
  }

  private async countSupporters(
    word: string,
    repo: Repository<WordApplyEntity> = this.applyRepo,
  ): Promise<number> {
    return repo.count({ where: { word, status: PENDING } })
  }

  private async supportersMap(words: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>()
    if (words.length === 0) return map
    const uniq = [...new Set(words)]
    const raws = await this.applyRepo
      .createQueryBuilder('a')
      .select('a.word', 'word')
      .addSelect('COUNT(*)', 'cnt')
      .where('a.word IN (:...words)', { words: uniq })
      .andWhere('a.status = :status', { status: PENDING })
      .groupBy('a.word')
      .getRawMany<{ word: string; cnt: string }>()
    for (const r of raws) map.set(r.word, parseInt(r.cnt, 10))
    return map
  }

  /** 在同一事务内以 ON CONFLICT 幂等写入 dictionary，并更新申请状态。 */
  private async tryAutoMergeWithManager(manager: EntityManager, word: string): Promise<void> {
    await manager.query(
      `INSERT INTO dictionary (word, length, frequency, rarity, tags, chars, meaning)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NULL)
       ON CONFLICT (word) DO NOTHING`,
      [
        word,
        word.length,
        0.02,
        'normal',
        JSON.stringify(['player-suggest']),
        JSON.stringify(word.split('')),
      ],
    )
    await manager.update(WordApplyEntity, { word }, { status: AUTO_MERGED })
  }
}
