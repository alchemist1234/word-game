import { Injectable, NotFoundException, Inject } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { GridPoolService } from '../grid-pool/grid-pool.service'
import { DictionaryService } from '../dictionary/dictionary.service'
import { validatePath, calcScore } from './check'
import type { CellPos, Rarity } from '../grid-gen/types'
import { REDIS_TOKEN } from '../common/redis.module'

const SESSION_TTL = 600 // 10 分钟（对局时长 + 缓冲）

/**
 * 游戏业务服务：取网格 / 提词校验计分 / 结算
 * 对齐迭代2详细设计 §6.3
 */
@Injectable()
export class GameService {
  constructor(
    private readonly gridPoolService: GridPoolService,
    private readonly dictionaryService: DictionaryService,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
  ) {}

  /** 取一张网格并创建对局会话 */
  async getGrid(difficulty: string): Promise<{
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
      score: '0',
      startedAt: Date.now().toString(),
    })
    await this.redis.expire(`match_session:${matchSessionId}`, SESSION_TTL)
    return {
      matchSessionId,
      grid: gridEntity.grid,
      size: gridEntity.size,
      duration: 180,
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
  }> {
    const session = await this.redis.hgetall(`match_session:${matchSessionId}`)
    if (!session || !session.grid) {
      throw new NotFoundException('对局会话不存在或已过期')
    }

    // 1. 路径校验
    const pathResult = validatePath(cells)
    if (!pathResult.valid) {
      return { valid: false, reason: pathResult.reason }
    }

    // 2. 拼字校验：路径上的字必须拼成提交的词（防作弊）
    const grid = JSON.parse(session.grid) as string[][]
    const gridChars = cells.map((c) => grid[c.row][c.col]).join('')
    if (gridChars !== word) {
      return { valid: false, reason: 'word_not_match' }
    }

    // 3. 词库查询
    const dictEntry = await this.dictionaryService.findByWord(word)
    if (!dictEntry) {
      return { valid: false, reason: 'not_in_dict' }
    }

    // 4. 去重
    const foundKey = `match_session:${matchSessionId}:found`
    const isDup = await this.redis.sismember(foundKey, word)
    if (isDup) {
      return { valid: false, reason: 'duplicate' }
    }

    // 5. 计分
    const score = calcScore(dictEntry.length, dictEntry.rarity as Rarity)

    // 6. 更新会话
    await this.redis.sadd(foundKey, word)
    await this.redis.expire(foundKey, SESSION_TTL)
    const currentScore = parseInt(session.score || '0', 10)
    const newScore = currentScore + score
    await this.redis.hset(`match_session:${matchSessionId}`, 'score', newScore.toString())

    return {
      valid: true,
      score,
      rarity: dictEntry.rarity,
      totalScore: newScore,
      combo: 0, // 迭代2无连击
    }
  }

  /** 结算 */
  async endGame(matchSessionId: string): Promise<{
    score: number
    foundWords: Array<{ word: string; score: number; rarity: string }>
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
    // 按分值降序
    foundWords.sort((a, b) => b.score - a.score)
    return {
      score: parseInt(session.score || '0', 10),
      foundWords,
    }
  }
}
