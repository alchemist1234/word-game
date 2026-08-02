import { Injectable, NotFoundException, Inject } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { GridPoolService } from '../grid-pool/grid-pool.service'
import { DictionaryService } from '../dictionary/dictionary.service'
import { validatePath, calcScore, calcComboBonus } from './check'
import type { CellPos, Rarity } from '../grid-gen/types'
import { REDIS_TOKEN } from '../common/redis.module'
import { UserFoundWordEntity } from '../user/user-found-word.entity'

const SESSION_TTL = 600
const COMBO_WINDOW_MS = 10000
const MAX_COMBO = 10

@Injectable()
export class GameService {
  constructor(
    private readonly gridPoolService: GridPoolService,
    private readonly dictionaryService: DictionaryService,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    @InjectRepository(UserFoundWordEntity)
    private readonly foundWordRepo: Repository<UserFoundWordEntity>,
  ) {}

  /** 取一张网格并创建对局会话 */
  async getGrid(
    difficulty: string,
    userId: number,
    duration = 90,
  ): Promise<{
    matchSessionId: string
    grid: string[][]
    size: number
    duration: number
  }> {
    const gridEntity = await this.gridPoolService.acquire(difficulty)
    if (!gridEntity) {
      throw new NotFoundException('暂无可用网格，请稍后重试')
    }
    const matchSessionId = uuidv4()
    await this.redis.hset(`match_session:${matchSessionId}`, {
      gridUuid: gridEntity.id,
      grid: JSON.stringify(gridEntity.grid),
      targetWords: JSON.stringify(gridEntity.targetWords),
      potentialCount: gridEntity.potentialCount.toString(),
      potentialWords: JSON.stringify(gridEntity.potentialWords),
      score: '0',
      comboScore: '0',
      combo: '0',
      maxCombo: '0',
      lastWordAt: '',
      userId: userId.toString(),
      duration: duration.toString(),
      isPerfect: '0',
      perfectBonus: '0',
      startedAt: Date.now().toString(),
    })
    await this.redis.expire(`match_session:${matchSessionId}`, SESSION_TTL)
    return {
      matchSessionId,
      grid: gridEntity.grid,
      size: gridEntity.size,
      duration,
    }
  }

  /** 提词校验 + 计分 */
  async submitWord(
    matchSessionId: string,
    word: string,
    cells: CellPos[],
  ): Promise<{
    valid: boolean
    reason?: string
    score?: number
    rarity?: string
    totalScore?: number
    combo?: number
    comboBonus?: number
    comboRemainingMs?: number
    perfect?: boolean
    perfectBonus?: number
    remainingSec?: number
  }> {
    const session = await this.redis.hgetall(`match_session:${matchSessionId}`)
    if (!session || !session.grid) {
      throw new NotFoundException('对局会话不存在或已过期')
    }

    const pathResult = validatePath(cells)
    if (!pathResult.valid) {
      return { valid: false, reason: pathResult.reason }
    }

    const grid = JSON.parse(session.grid) as string[][]
    const gridChars = cells.map((c) => grid[c.row][c.col]).join('')
    if (gridChars !== word) {
      return { valid: false, reason: 'word_not_match' }
    }

    const dictEntry = await this.dictionaryService.findByWord(word)
    if (!dictEntry) {
      return { valid: false, reason: 'not_in_dict' }
    }

    const foundKey = `match_session:${matchSessionId}:found`
    const isDup = await this.redis.sismember(foundKey, word)
    if (isDup) {
      return { valid: false, reason: 'duplicate' }
    }

    // 连击演进
    const now = Date.now()
    const lastWordAt = parseInt(session.lastWordAt || '0', 10)
    let combo = 0
    if (lastWordAt > 0 && now - lastWordAt <= COMBO_WINDOW_MS) {
      combo = Math.min(parseInt(session.combo || '0', 10) + 1, MAX_COMBO)
    }
    const comboBonus = calcComboBonus(combo)
    const newMaxCombo = Math.max(parseInt(session.maxCombo || '0', 10), combo)

    const score =
      calcScore(dictEntry.length, dictEntry.rarity as Rarity) + comboBonus

    await this.redis.sadd(foundKey, word)
    await this.redis.expire(foundKey, SESSION_TTL)
    const currentScore = parseInt(session.score || '0', 10)
    const currentComboScore = parseInt(session.comboScore || '0', 10)
    const newScore = currentScore + score
    await this.redis.hset(`match_session:${matchSessionId}`, {
      score: newScore.toString(),
      comboScore: (currentComboScore + comboBonus).toString(),
      combo: combo.toString(),
      maxCombo: newMaxCombo.toString(),
      lastWordAt: now.toString(),
    })

    // 完美通关检测：找到全部潜在词 -> 提前结束 + 剩余时间加成
    const foundCount = await this.redis.scard(foundKey)
    const potentialCount = parseInt(session.potentialCount || '0', 10)
    if (foundCount >= potentialCount && potentialCount > 0) {
      const sessionDuration = parseInt(session.duration || '90', 10)
      const startedAt = parseInt(session.startedAt || '0', 10)
      const elapsedSec =
        startedAt > 0
          ? Math.floor((Date.now() - startedAt) / 1000)
          : sessionDuration
      const remainingSec = Math.max(0, sessionDuration - elapsedSec)
      // 加成规则：剩余秒数 × 3 + 完美奖励 50
      const perfectBonus = remainingSec * 3 + 50
      const scoreWithBonus = newScore + perfectBonus
      await this.redis.hset(`match_session:${matchSessionId}`, {
        score: scoreWithBonus.toString(),
        isPerfect: '1',
        perfectBonus: perfectBonus.toString(),
      })
      return {
        valid: true,
        score,
        rarity: dictEntry.rarity,
        totalScore: scoreWithBonus,
        combo,
        comboBonus,
        comboRemainingMs: COMBO_WINDOW_MS,
        perfect: true,
        perfectBonus,
        remainingSec,
      }
    }

    return {
      valid: true,
      score,
      rarity: dictEntry.rarity,
      totalScore: newScore,
      combo,
      comboBonus,
      comboRemainingMs: COMBO_WINDOW_MS,
      perfect: false,
    }
  }

  /** 结算（含图鉴批量收集） */
  async endGame(matchSessionId: string): Promise<{
    score: number
    comboScore: number
    maxCombo: number
    potentialCount: number
    perfect: boolean
    perfectBonus: number
    foundWords: Array<{ word: string; score: number; rarity: string }>
    unfoundWords: Array<{ word: string; rarity: string }>
  }> {
    const session = await this.redis.hgetall(`match_session:${matchSessionId}`)
    if (!session || !session.grid) {
      throw new NotFoundException('对局会话不存在或已过期')
    }
    const foundWordsStr = await this.redis.smembers(
      `match_session:${matchSessionId}:found`,
    )
    const foundWords: Array<{ word: string; score: number; rarity: string }> = []
    for (const w of foundWordsStr) {
      const dict = await this.dictionaryService.findByWord(w)
      if (dict) {
        foundWords.push({
          word: w,
          score: calcScore(dict.length, dict.rarity as Rarity),
          rarity: dict.rarity,
        })
      }
    }
    foundWords.sort((a, b) => b.score - a.score)

    // 图鉴批量收集（upsert user_found_words）
    const userId = parseInt(session.userId || '0', 10)
    if (userId > 0) {
      await this.upsertFoundWords(userId, foundWords)
    }

    // 未找到的词（网格潜在词 - 已找到），按稀有度从高到低
    const unfoundWords: Array<{ word: string; rarity: string }> = []
    if (session.potentialWords) {
      const potential = JSON.parse(session.potentialWords) as string[]
      const foundSet = new Set(foundWordsStr)
      const RARITY_ORDER: Record<string, number> = {
        idiom: 0,
        rare: 1,
        normal: 2,
        common: 3,
      }
      for (const w of potential) {
        if (foundSet.has(w)) continue
        const dict = await this.dictionaryService.findByWord(w)
        if (dict) {
          unfoundWords.push({ word: w, rarity: dict.rarity })
        }
      }
      unfoundWords.sort(
        (a, b) =>
          (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9),
      )
    }

    return {
      score: parseInt(session.score || '0', 10),
      comboScore: parseInt(session.comboScore || '0', 10),
      maxCombo: parseInt(session.maxCombo || '0', 10),
      potentialCount: parseInt(session.potentialCount || '0', 10),
      perfect: session.isPerfect === '1',
      perfectBonus: parseInt(session.perfectBonus || '0', 10),
      foundWords,
      unfoundWords,
    }
  }

  /** 图鉴 upsert：已存在 foundCount+1，不存在插入 */
  private async upsertFoundWords(
    userId: number,
    words: Array<{ word: string; rarity: string }>,
  ): Promise<void> {
    for (const w of words) {
      const existing = await this.foundWordRepo.findOne({
        where: { userId, word: w.word },
      })
      if (existing) {
        existing.foundCount += 1
        await this.foundWordRepo.save(existing)
      } else {
        await this.foundWordRepo.save(
          this.foundWordRepo.create({
            userId,
            word: w.word,
            rarity: w.rarity,
            foundCount: 1,
          }),
        )
      }
    }
  }
}
