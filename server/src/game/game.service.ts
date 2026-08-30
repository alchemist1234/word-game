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
import { GridPoolEntity } from '../grid-pool/grid-pool.entity'

const SESSION_TTL = 600
const COMBO_WINDOW_MS = 10000
const MAX_COMBO = 10

export interface RawGrid {
  id: string
  grid: string[][]
  targetWords: string[]
  potentialWords: string[]
  potentialCount: number
  size: number
}

@Injectable()
export class GameService {
  constructor(
    private readonly gridPoolService: GridPoolService,
    private readonly dictionaryService: DictionaryService,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    @InjectRepository(UserFoundWordEntity)
    private readonly foundWordRepo: Repository<UserFoundWordEntity>,
  ) {}

  /** 取一张网格并创建对局会话（单人/自由模式） */
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
    return this.createSessionFromGrid(gridEntity, userId, duration)
  }

  /** 任意原始网格建会话（迭代7：好友/每日复用） */
  async createSessionFromRaw(
    raw: RawGrid,
    userId: number,
    duration = 90,
    matchId?: string,
  ): Promise<{
    matchSessionId: string
    grid: string[][]
    size: number
    duration: number
    gridSeed: string
  }> {
    const matchSessionId = uuidv4()
    const potentialWithRarity = raw.potentialWords.map((w) => {
      const dict = this.dictionaryService.findByWord(w)
      return {
        word: w,
        rarity: dict?.rarity ?? 'common',
        length: dict?.length ?? w.length,
      }
    })
    const sessionFields: Record<string, string> = {
      gridUuid: raw.id,
      grid: JSON.stringify(raw.grid),
      targetWords: JSON.stringify(raw.targetWords),
      potentialCount: raw.potentialCount.toString(),
      potentialWords: JSON.stringify(raw.potentialWords),
      potentialWordsWithRarity: JSON.stringify(potentialWithRarity),
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
    }
    if (matchId) sessionFields.matchId = matchId
    await this.redis.hset(`match_session:${matchSessionId}`, sessionFields)
    await this.redis.expire(`match_session:${matchSessionId}`, SESSION_TTL)
    return {
      matchSessionId,
      grid: raw.grid,
      size: raw.size,
      duration,
      gridSeed: raw.id,
    }
  }

  /**
   * 用指定网格创建对局会话（对战模式复用：双方同一 gridEntity，保证同网格）
   * 迭代6详细设计 §2.1：对战每玩家独立 match_session，hset 附加 matchId 标记
   */
  async createSessionFromGrid(
    gridEntity: GridPoolEntity,
    userId: number,
    duration = 90,
    matchId?: string,
  ): Promise<{
    matchSessionId: string
    grid: string[][]
    size: number
    duration: number
    gridSeed: string
  }> {
    return this.createSessionFromRaw(
      {
        id: gridEntity.id,
        grid: gridEntity.grid,
        targetWords: gridEntity.targetWords,
        potentialWords: gridEntity.potentialWords,
        potentialCount: gridEntity.potentialCount,
        size: gridEntity.size,
      },
      userId,
      duration,
      matchId,
    )
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
    matchId?: string
  }> {
    const foundKey = `match_session:${matchSessionId}:found`
    // 读批 pipeline：会话 + 重复检测（2 次往返压 1 次）
    const readPipe = this.redis.pipeline()
    readPipe.hgetall(`match_session:${matchSessionId}`)
    readPipe.sismember(foundKey, word)
    const readResults = await readPipe.exec()
    if (!readResults) throw new NotFoundException('对局会话读取失败')
    const session = readResults[0][1] as Record<string, string>
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

    const isDup = readResults[1][1] as number
    if (isDup) {
      return { valid: false, reason: 'duplicate' }
    }

    // 潜在词池判定（内存 Map，不查 PG）
    const potentialMap = this.buildPotentialMap(session)
    const entry = potentialMap.get(word)
    if (!entry) {
      return { valid: false, reason: 'not_in_dict' }
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
      calcScore(entry.length, entry.rarity as Rarity) + comboBonus

    const currentScore = parseInt(session.score || '0', 10)
    const currentComboScore = parseInt(session.comboScore || '0', 10)
    const newScore = currentScore + score
    const potentialCount = parseInt(session.potentialCount || '0', 10)

    // 写批 pipeline：sadd + hset + expire + scard（4 次往返压 1 次）
    const writePipe = this.redis.pipeline()
    writePipe.sadd(foundKey, word)
    writePipe.hset(`match_session:${matchSessionId}`, {
      score: newScore.toString(),
      comboScore: (currentComboScore + comboBonus).toString(),
      combo: combo.toString(),
      maxCombo: newMaxCombo.toString(),
      lastWordAt: now.toString(),
    })
    writePipe.expire(foundKey, SESSION_TTL)
    writePipe.scard(foundKey)
    const writeResults = await writePipe.exec()
    if (!writeResults) throw new NotFoundException('对局状态写入失败')

    // 完美通关检测：找到全部潜在词 -> 提前结束 + 剩余时间加成（对战模式固定时长，不触发）
    const foundCount = writeResults[3][1] as number
    if (!session.matchId && foundCount >= potentialCount && potentialCount > 0) {
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
        rarity: entry.rarity,
        totalScore: scoreWithBonus,
        combo,
        comboBonus,
        comboRemainingMs: COMBO_WINDOW_MS,
        perfect: true,
        perfectBonus,
        remainingSec,
        matchId: session.matchId,
      }
    }

    return {
      valid: true,
      score,
      rarity: entry.rarity,
      totalScore: newScore,
      combo,
      comboBonus,
      comboRemainingMs: COMBO_WINDOW_MS,
      perfect: false,
      matchId: session.matchId,
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
    const potentialMap = this.buildPotentialMap(session)
    for (const w of foundWordsStr) {
      const entry = potentialMap.get(w)
      if (entry) {
        foundWords.push({
          word: w,
          score: calcScore(entry.length, entry.rarity as Rarity),
          rarity: entry.rarity,
        })
      }
    }
    foundWords.sort((a, b) => b.score - a.score)

    // 图鉴批量收集（upsert user_found_words）
    const userId = parseInt(session.userId || '0', 10)
    if (userId > 0) {
      await this.upsertFoundWords(userId, foundWords)
    }

    // 总榜：历史最高单局分（迭代7 §4.1，集中更新，失败不影响结算）
    if (userId > 0) {
      try {
        const scoreForLb = parseInt(session.score || '0', 10)
        const cur = await this.redis.zscore('lb:all', userId.toString())
        const curNum = cur ? parseInt(cur, 10) : null
        if (curNum === null || scoreForLb > curNum) {
          await this.redis.zadd('lb:all', scoreForLb.toString(), userId.toString())
        }
      } catch {
        // 忽略排行榜更新失败
      }
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
        const entry = potentialMap.get(w)
        if (entry) {
          unfoundWords.push({ word: w, rarity: entry.rarity })
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

  /**
   * 构建潜在词池 Map（内存判定，不查 PG）
   * 兼容旧会话：无 potentialWordsWithRarity 时回退词库查询
   */
  private buildPotentialMap(
    session: Record<string, string>,
  ): Map<string, { word: string; rarity: string; length: number }> {
    if (session.potentialWordsWithRarity) {
      const list = JSON.parse(session.potentialWordsWithRarity) as Array<{
        word: string
        rarity: string
        length: number
      }>
      return new Map(list.map((p) => [p.word, p]))
    }
    // 回退：旧会话无 potentialWordsWithRarity，从 potentialWords + 词库查询构建
    const potential = session.potentialWords
      ? (JSON.parse(session.potentialWords) as string[])
      : []
    const map = new Map<
      string,
      { word: string; rarity: string; length: number }
    >()
    for (const w of potential) {
      const dict = this.dictionaryService.findByWord(w)
      if (dict) {
        map.set(w, { word: w, rarity: dict.rarity, length: dict.length })
      }
    }
    return map
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
