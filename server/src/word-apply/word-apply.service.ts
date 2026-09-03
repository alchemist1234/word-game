import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, MoreThanOrEqual } from 'typeorm'
import Redis from 'ioredis'
import { REDIS_TOKEN } from '../common/redis.module'
import { config } from '../common/config'
import { WordApplyEntity } from './word-apply.entity'
import { DictionaryEntity } from '../dictionary/dictionary.entity'
import { DictionaryService } from '../dictionary/dictionary.service'
import { validatePath } from '../game/check'
import type { CellPos } from '../grid-gen/types'

const WORD_RE = /^[\u4e00-\u9fff]{2,6}$/
const PENDING = 'pending'
const AUTO_MERGED = 'auto_merged'

export interface ApplyResult {
  applied: boolean
  alreadyApplied?: boolean
  inDict?: boolean
  supporters: number
  threshold: number
  status: string
  autoMerged: boolean
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
  ) {}

  private get threshold(): number {
    return config.wordApply.threshold
  }

  /** 申请收录（幂等：一人一票） */
  async apply(
    userId: number,
    rawWord: string,
    matchSessionId?: string,
    cells?: CellPos[],
  ): Promise<ApplyResult> {
    const word = (rawWord ?? '').trim()
    if (!WORD_RE.test(word)) {
      throw new BadRequestException('WORD_INVALID')
    }
    // 已在库：不计数，直接告知
    if (this.dictionaryService.findByWord(word)) {
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
      const path = (cells ?? []).map((c) => ({ row: c.row, col: c.col }))
      if (path.length < 2 || !path.every((c) => Number.isInteger(c.row) && Number.isInteger(c.col))) {
        throw new BadRequestException('EVIDENCE_INVALID')
      }
      if (!validatePath(path).valid) {
        throw new BadRequestException('EVIDENCE_INVALID')
      }
      let grid: string[][] = []
      try {
        grid = JSON.parse(session.grid) as string[][]
      } catch {
        throw new BadRequestException('EVIDENCE_INVALID')
      }
      const gridChars = path
        .map((c) => grid[c.row]?.[c.col] ?? '')
        .join('')
      if (gridChars !== word) {
        throw new BadRequestException('EVIDENCE_INVALID')
      }
      source = 'game'
      gridSeed = session.gridUuid ?? null
      cellsJson = path
    }

    // 单用户每日上限
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayCount = await this.applyRepo.count({
      where: { userId, createdAt: MoreThanOrEqual(today) },
    })
    if (todayCount >= config.wordApply.dailyLimit) {
      throw new BadRequestException('DAILY_LIMIT')
    }

    // 幂等：一人一票，重复提交只刷新时间
    const existing = await this.applyRepo.findOne({ where: { word, userId } })
    if (existing) {
      existing.updatedAt = new Date()
      await this.applyRepo.save(existing).catch((e: Error) => {
        this.logger.warn(`touch apply failed: ${e.message}`)
      })
      const supporters = await this.countSupporters(word)
      return {
        applied: false,
        alreadyApplied: true,
        supporters,
        threshold: this.threshold,
        status: existing.status,
        autoMerged: false,
      }
    }

    const entity = this.applyRepo.create({
      word,
      userId,
      status: PENDING,
      source,
      matchSessionId: matchSessionId ?? null,
      cells: cellsJson,
      gridSeed,
    })
    await this.applyRepo.save(entity)

    const supporters = await this.countSupporters(word)
    if (supporters >= this.threshold) {
      await this.tryAutoMerge(word)
      return {
        applied: true,
        supporters,
        threshold: this.threshold,
        status: AUTO_MERGED,
        autoMerged: true,
      }
    }
    return {
      applied: true,
      supporters,
      threshold: this.threshold,
      status: PENDING,
      autoMerged: false,
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
    const w = (word ?? '').trim()
    if (!WORD_RE.test(w)) {
      throw new BadRequestException('WORD_INVALID')
    }
    const inDict = !!this.dictionaryService.findByWord(w)
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

  private async countSupporters(word: string): Promise<number> {
    return this.applyRepo.count({ where: { word, status: PENDING } })
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

  /** 达阈值自动入库（主键去重防并发重复） */
  private async tryAutoMerge(word: string): Promise<void> {
    const exists = await this.dictRepo.findOne({ where: { word } })
    if (!exists) {
      try {
        await this.dictRepo.save(
          this.dictRepo.create({
            word,
            length: word.length,
            frequency: 0.02,
            rarity: 'normal',
            tags: ['player-suggest'],
            chars: word.split(''),
            meaning: null,
          }),
        )
      } catch (e) {
        // 并发重复插入：主键冲突则视为已入库，继续置状态
        const again = await this.dictRepo.findOne({ where: { word } })
        if (!again) {
          this.logger.warn(`auto merge save failed: ${(e as Error).message}`)
          throw e
        }
      }
    }
    await this.applyRepo.update({ word }, { status: AUTO_MERGED })
    await this.dictionaryService.refresh()
    this.logger.log(`word auto merged: ${word}`)
  }
}
