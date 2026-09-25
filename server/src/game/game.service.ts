import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, EntityManager, Repository } from 'typeorm'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { GridPoolService } from '../grid-pool/grid-pool.service'
import { DictionaryService } from '../dictionary/dictionary.service'
import { validatePath, calcScore } from './check'
import type { CellPos, Rarity } from '../grid-gen/types'
import { REDIS_TOKEN } from '../common/redis.module'
import { GridPoolEntity } from '../grid-pool/grid-pool.entity'
import { AchievementService } from '../achievement/achievement.service'
import { GameSettlementEntity } from './game-settlement.entity'
import {
  SUBMIT_WORD_SCRIPT,
  ASSERT_END_LOCK_SCRIPT,
  COMMIT_SETTLEMENT_SCRIPT,
  FINALIZE_CACHED_SETTLEMENT_SCRIPT,
  UPDATE_LEADERBOARD_SCRIPT,
  RENEW_END_LOCK_SCRIPT,
  RELEASE_END_LOCK_SCRIPT,
} from './redis-scripts'

const SESSION_TTL = 600
const END_LOCK_TTL_SECONDS = 300
const END_LOCK_RENEW_INTERVAL_MS = 30000
const COMBO_WINDOW_MS = 10000
const MAX_COMBO = 10
const MATCH_COUNTDOWN_GRACE_MS = 3000

export interface GameEndResult {
  score: number
  comboScore: number
  maxCombo: number
  potentialCount: number
  perfect: boolean
  perfectBonus: number
  foundWords: Array<{ word: string; score: number; rarity: string }>
  unfoundWords: Array<{ word: string; rarity: string }>
}

export interface SubmitWordResult {
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
}

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
  private readonly logger = new Logger(GameService.name)

  constructor(
    private readonly gridPoolService: GridPoolService,
    private readonly dictionaryService: DictionaryService,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    @InjectRepository(GameSettlementEntity)
    private readonly settlementRepo: Repository<GameSettlementEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => AchievementService))
    private readonly achievementService?: AchievementService,
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
    const startedAt = Date.now()
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
      startedAt: startedAt.toString(),
      deadlineAt: (
        startedAt +
        Math.max(0, duration) * 1000 +
        (matchId ? MATCH_COUNTDOWN_GRACE_MS : 0)
      ).toString(),
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

  /** 提词校验 + 计分（Redis Lua 原子更新） */
  async submitWord(
    userId: number,
    matchSessionId: string,
    word: string,
    cells: CellPos[],
  ): Promise<SubmitWordResult> {
    const sessionKey = `match_session:${matchSessionId}`
    const foundKey = `${sessionKey}:found`
    const session = await this.redis.hgetall(sessionKey)
    if (!session || !session.grid) {
      throw new NotFoundException('对局会话不存在或已过期')
    }
    this.assertSessionOwner(session, userId)

    let grid: string[][]
    try {
      const parsed: unknown = JSON.parse(session.grid)
      if (
        !Array.isArray(parsed) ||
        parsed.length === 0 ||
        parsed.some(
          (row) => !Array.isArray(row) || row.length !== parsed.length,
        )
      ) {
        throw new Error('invalid grid')
      }
      grid = parsed as string[][]
    } catch {
      throw new NotFoundException('对局网格数据无效')
    }

    const pathResult = validatePath(cells, grid.length)
    if (!pathResult.valid) {
      return { valid: false, reason: pathResult.reason }
    }

    const gridChars = cells.map((c) => grid[c.row][c.col]).join('')
    if (gridChars !== word) {
      return { valid: false, reason: 'word_not_match' }
    }

    // 潜在词池判定（会话快照，不查 PG）
    const potentialMap = this.buildPotentialMap(session)
    const entry = potentialMap.get(word)
    if (!entry) {
      return { valid: false, reason: 'not_in_dict' }
    }

    const deadlineAt = this.getDeadlineAt(session)

    const raw = await this.redis.eval(
      SUBMIT_WORD_SCRIPT,
      3,
      sessionKey,
      foundKey,
      `${sessionKey}:end-lock`,
      word,
      calcScore(entry.length, entry.rarity as Rarity).toString(),
      Date.now().toString(),
      COMBO_WINDOW_MS.toString(),
      MAX_COMBO.toString(),
      parseInt(session.potentialCount || '0', 10).toString(),
      deadlineAt.toString(),
      SESSION_TTL.toString(),
    )
    const values = Array.isArray(raw) ? raw : []
    const status = String(values[0] ?? '')
    if (status === 'missing') {
      throw new NotFoundException('对局会话不存在或已过期')
    }
    if (status === 'settling') {
      throw new ConflictException('对局正在结算，请稍后重试')
    }
    if (status === 'settled') {
      return { valid: false, reason: 'game_finished' }
    }
    if (status === 'expired') {
      return { valid: false, reason: 'game_expired' }
    }
    if (status === 'duplicate') {
      return { valid: false, reason: 'duplicate' }
    }
    if (status !== 'ok') {
      throw new ConflictException('提词状态更新失败，请重试')
    }

    const score = Number(values[1] ?? 0)
    const totalScore = Number(values[2] ?? score)
    const combo = Number(values[3] ?? 0)
    const comboBonus = Number(values[4] ?? 0)
    const perfect = String(values[6] ?? '0') === '1'
    const perfectBonus = Number(values[7] ?? 0)
    const remainingSec = Number(values[8] ?? 0)
    const matchId = String(values[9] ?? session.matchId ?? '')

    return {
      valid: true,
      score,
      rarity: entry.rarity,
      totalScore,
      combo,
      comboBonus,
      comboRemainingMs: COMBO_WINDOW_MS,
      perfect,
      perfectBonus,
      remainingSec,
      matchId: matchId || undefined,
    }
  }

  /** 结算（含图鉴批量收集）；同一 session 只允许首次执行副作用。 */
  async endGame(userId: number, matchSessionId: string): Promise<GameEndResult> {
    const sessionKey = `match_session:${matchSessionId}`
    const resultKey = `${sessionKey}:result`
    const lockKey = `${sessionKey}:end-lock`
    const session = await this.redis.hgetall(sessionKey)
    if (!session || !session.grid) {
      throw new NotFoundException('对局会话不存在或已过期')
    }
    this.assertSessionOwner(session, userId)

    const cached = await this.readCachedEndResult(resultKey)
    if (cached) return this.returnCachedWithEffects(userId, sessionKey, cached)

    const lockToken = uuidv4()
    const lock = await this.redis.set(
      lockKey,
      lockToken,
      'EX',
      END_LOCK_TTL_SECONDS,
      'NX',
    )
    if (lock !== 'OK') {
      for (let attempt = 0; attempt < 5; attempt++) {
        const latest = await this.readCachedEndResult(resultKey)
        if (latest) return this.returnCachedWithEffects(userId, sessionKey, latest)
        await new Promise<void>((resolve) => setTimeout(resolve, 50))
      }
      throw new ConflictException('对局正在结算，请稍后重试')
    }

    let renewalTimer: NodeJS.Timeout | undefined
    let leaseLost = false
    try {
      await this.redis.hset(sessionKey, {
        settling: '1',
        settleLockToken: lockToken,
        settleLockUntil: String(Date.now() + END_LOCK_TTL_SECONDS * 1000),
      })
      renewalTimer = setInterval(() => {
        void this.renewEndLock(lockKey, sessionKey, lockToken).then((renewed) => {
          if (!renewed) leaseLost = true
        })
      }, END_LOCK_RENEW_INTERVAL_MS)
      renewalTimer.unref()

      const latestCached = await this.readCachedEndResult(resultKey)
      if (latestCached) {
        return this.returnCachedWithEffects(userId, sessionKey, latestCached)
      }

      const latestSession = await this.redis.hgetall(sessionKey)
      if (!latestSession || !latestSession.grid) {
        throw new NotFoundException('对局会话不存在或已过期')
      }
      this.assertSessionOwner(latestSession, userId)
      await this.assertEndLockOwned(lockKey, sessionKey, lockToken)
      const result = await this.persistSettlement(
        latestSession,
        matchSessionId,
        userId,
      )
      if (leaseLost) {
        throw new ConflictException('结算租约已失效，请重试')
      }
      await this.assertEndLockOwned(lockKey, sessionKey, lockToken)
      const commitResult = await this.redis.eval(
        COMMIT_SETTLEMENT_SCRIPT,
        3,
        lockKey,
        sessionKey,
        resultKey,
        lockToken,
        JSON.stringify(result),
        SESSION_TTL.toString(),
      )
      const commitStatus = Array.isArray(commitResult)
        ? String(commitResult[0] ?? '')
        : ''
      if (commitStatus !== 'ok') {
        throw new ConflictException('结算租约已失效，请重试')
      }
      return result
    } finally {
      if (renewalTimer) clearInterval(renewalTimer)
      try {
        await this.redis.eval(
          RELEASE_END_LOCK_SCRIPT,
          2,
          lockKey,
          sessionKey,
          lockToken,
        )
      } catch (error) {
        this.logger.warn(`release settlement lock failed: ${(error as Error).message}`)
      }
    }
  }

  private async assertEndLockOwned(
    lockKey: string,
    sessionKey: string,
    lockToken: string,
  ): Promise<void> {
    const result = await this.redis.eval(
      ASSERT_END_LOCK_SCRIPT,
      2,
      lockKey,
      sessionKey,
      lockToken,
    )
    if (Number(result) !== 1) {
      throw new ConflictException('结算租约已失效，请重试')
    }
  }

  private async renewEndLock(
    lockKey: string,
    sessionKey: string,
    lockToken: string,
  ): Promise<boolean> {
    try {
      const result = await this.redis.eval(
        RENEW_END_LOCK_SCRIPT,
        2,
        lockKey,
        sessionKey,
        lockToken,
        END_LOCK_TTL_SECONDS.toString(),
        String(Date.now() + END_LOCK_TTL_SECONDS * 1000),
      )
      return Number(result) === 1
    } catch (error) {
      this.logger.warn(`renew settlement lock failed: ${(error as Error).message}`)
      return false
    }
  }

  private async returnCachedWithEffects(
    userId: number,
    sessionKey: string,
    result: GameEndResult,
  ): Promise<GameEndResult> {
    // 补齐可能部分提交成功的 settled 标记，避免缓存存在但提词仍能继续。
    const finalized = await this.redis.eval(
      FINALIZE_CACHED_SETTLEMENT_SCRIPT,
      2,
      sessionKey,
      `${sessionKey}:result`,
    )
    const finalStatus = Array.isArray(finalized)
      ? String(finalized[0] ?? '')
      : ''
    if (finalStatus !== 'ok') {
      throw new ConflictException('结算状态补写失败，请重试')
    }
    // 缓存命中也补偿排行榜/成就等非事务副作用，支持失败后重试。
    await this.runPostSettlementEffects(userId, result)
    return result
  }

  private async readCachedEndResult(
    resultKey: string,
  ): Promise<GameEndResult | null> {
    const cached = await this.redis.get(resultKey)
    if (!cached) return null
    try {
      return this.parseEndResult(cached)
    } catch (error) {
      this.logger.warn(`discard invalid settlement cache: ${(error as Error).message}`)
      await this.redis.del(resultKey)
      return null
    }
  }

  private parseEndResult(value: string): GameEndResult {
    try {
      const parsed: unknown = JSON.parse(value)
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as { score?: unknown }).score === 'number' &&
        Array.isArray((parsed as { foundWords?: unknown }).foundWords) &&
        Array.isArray((parsed as { unfoundWords?: unknown }).unfoundWords)
      ) {
        return parsed as GameEndResult
      }
    } catch {
      throw new ConflictException('结算结果缓存损坏')
    }
    throw new ConflictException('结算结果缓存格式错误')
  }

  private async buildEndResult(
    session: Record<string, string>,
    matchSessionId: string,
  ): Promise<GameEndResult> {
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

    const unfoundWords = this.getUnfoundWords(session, foundWordsStr, potentialMap)
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

  private async persistSettlement(
    session: Record<string, string>,
    matchSessionId: string,
    userId: number,
  ): Promise<GameEndResult> {
    const existing = await this.settlementRepo.findOne({
      where: { matchSessionId },
    })
    if (existing) {
      await this.runPostSettlementEffects(
        Number(existing.userId),
        existing.result,
      )
      return existing.result
    }

    const calculated = await this.buildEndResult(session, matchSessionId)
    let result: GameEndResult
    try {
      result = await this.dataSource.transaction(async (manager) => {
        const raced = await manager.findOne(GameSettlementEntity, {
          where: { matchSessionId },
        })
        if (raced) return raced.result
        await this.upsertFoundWordsWithManager(
          manager,
          userId,
          calculated.foundWords,
        )
        await manager.save(
          manager.create(GameSettlementEntity, {
            matchSessionId,
            userId,
            result: calculated,
          }),
        )
        return calculated
      })
    } catch (error) {
      const raced = await this.settlementRepo.findOne({
        where: { matchSessionId },
      })
      if (!raced) throw error
      result = raced.result
    }

    await this.runPostSettlementEffects(userId, result)
    return result
  }

  private async runPostSettlementEffects(
    userId: number,
    result: GameEndResult,
  ): Promise<void> {
    if (userId <= 0) return
    await this.updateLeaderboard(userId, result.score)
    await this.checkAchievements(userId, result)
  }

  private async upsertFoundWordsWithManager(
    manager: EntityManager,
    userId: number,
    words: Array<{ word: string; rarity: string }>,
  ): Promise<void> {
    for (const word of words) {
      await manager.query(
        `INSERT INTO user_found_words (user_id, word, rarity, found_count, first_found_at)
         VALUES ($1, $2, $3, 1, NOW())
         ON CONFLICT (user_id, word)
         DO UPDATE SET found_count = user_found_words.found_count + 1`,
        [userId, word.word, word.rarity],
      )
    }
  }

  private getUnfoundWords(
    session: Record<string, string>,
    foundWordsStr: string[],
    potentialMap: Map<string, { rarity: string }>,
  ): Array<{ word: string; rarity: string }> {
    if (!session.potentialWords) return []
    let potential: string[]
    try {
      potential = JSON.parse(session.potentialWords) as string[]
    } catch {
      return []
    }
    const foundSet = new Set(foundWordsStr)
    const rarityOrder: Record<string, number> = {
      idiom: 0,
      rare: 1,
      normal: 2,
      common: 3,
    }
    const unfoundWords = potential
      .filter((word) => !foundSet.has(word))
      .flatMap((word) => {
        const entry = potentialMap.get(word)
        return entry ? [{ word, rarity: entry.rarity }] : []
      })
    unfoundWords.sort(
      (a, b) =>
        (rarityOrder[a.rarity] ?? 9) - (rarityOrder[b.rarity] ?? 9),
    )
    return unfoundWords
  }

  private async updateLeaderboard(userId: number, score: number): Promise<void> {
    try {
      await this.redis.eval(
        UPDATE_LEADERBOARD_SCRIPT,
        1,
        'lb:all',
        userId.toString(),
        score.toString(),
      )
    } catch (error) {
      // 排行榜失败不能阻断结算；保留主流程可用性。
      this.logger.warn(`leaderboard update failed: ${(error as Error).message}`)
    }
  }

  private async checkAchievements(
    userId: number,
    result: GameEndResult,
  ): Promise<void> {
    if (!this.achievementService) return
    try {
      const maxCombo = result.maxCombo
      if (maxCombo >= 5) {
        await this.achievementService.check(userId, 'maxCombo', { maxCombo })
      }
      if (result.foundWords.some((word) => word.rarity === 'idiom')) {
        await this.achievementService.check(userId, 'word_found', {
          rarity: 'idiom',
        })
      }
      await this.achievementService.check(userId, 'pokedex', {})
    } catch (error) {
      // 成就失败不能重复阻断已完成的结算。
      this.logger.warn(`achievement check failed: ${(error as Error).message}`)
    }
  }

  private assertSessionOwner(
    session: Record<string, string>,
    userId: number,
  ): void {
    if (session.userId !== userId.toString()) {
      throw new ForbiddenException('对局会话不属于当前用户')
    }
  }

  private getDeadlineAt(session: Record<string, string>): number {
    const explicit = Number(session.deadlineAt)
    if (Number.isFinite(explicit) && explicit > 0) return explicit
    const startedAt = Number(session.startedAt)
    const duration = Number(session.duration)
    if (Number.isFinite(startedAt) && startedAt > 0 && Number.isFinite(duration)) {
      return startedAt + Math.max(0, duration) * 1000
    }
    return 0
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

}
