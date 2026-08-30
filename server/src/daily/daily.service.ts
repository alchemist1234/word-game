import { Injectable, OnModuleInit, Logger, NotFoundException, BadRequestException, ForbiddenException, Inject } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, LessThan } from 'typeorm'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { REDIS_TOKEN } from '../common/redis.module'
import { GameService } from '../game/game.service'
import { DictionaryService } from '../dictionary/dictionary.service'
import { generateGrid } from '../grid-gen/grid-gen'
import { cstDateStr, cstMonthStr, cstDateToDayKey } from '../common/time'
import { DailyChallengeEntity } from './daily-challenge.entity'
import { DailyAttemptEntity } from './daily-attempt.entity'
import { LeaderboardSnapshotEntity } from '../leaderboard/leaderboard-snapshot.entity'
import { UserEntity } from '../user/user.entity'

@Injectable()
export class DailyService implements OnModuleInit {
  private readonly logger = new Logger(DailyService.name)

  constructor(
    private readonly gameService: GameService,
    private readonly dictionaryService: DictionaryService,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    @InjectRepository(DailyChallengeEntity)
    private readonly dailyRepo: Repository<DailyChallengeEntity>,
    @InjectRepository(DailyAttemptEntity)
    private readonly attemptRepo: Repository<DailyAttemptEntity>,
    @InjectRepository(LeaderboardSnapshotEntity)
    private readonly snapshotRepo: Repository<LeaderboardSnapshotEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureToday()
  }

  @Interval(5 * 60 * 1000)
  async intervalEnsure(): Promise<void> {
    await this.ensureToday()
  }

  async ensureToday(): Promise<DailyChallengeEntity> {
    const today = cstDateStr()
    let entity = await this.dailyRepo.findOne({ where: { date: today } })
    if (entity) return entity
    // settle pending before creating today
    const pending = await this.dailyRepo.find({
      where: { settled: false },
      order: { date: 'DESC' },
    })
    // find most recent not today and not settled
    for (const p of pending) {
      if (p.date !== today) {
        await this.settleDaily(p.date).catch((e) => this.logger.warn(`settleDaily ${p.date} failed: ${(e as Error).message}`))
        break
      }
    }
    // check month rollover: if today is first of month, settle previous month's season
    const month = cstMonthStr(new Date())
    const day = parseInt(today.slice(8, 10), 10)
    if (day === 1) {
      // previous month
      const d = new Date()
      // get previous month string via shifting date to last day of prev month
      const prev = new Date(d.getTime() - 24 * 60 * 60 * 1000 * 2)
      const prevMonth = cstMonthStr(prev)
      if (prevMonth !== month) {
        await this.settleSeason(prevMonth).catch((e) => this.logger.warn(`settleSeason ${prevMonth} failed: ${(e as Error).message}`))
      }
    }
    // generate today grid
    const { words, trie } = await this.dictionaryService.loadAll()
    const generated = generateGrid('standard', words, trie)
    const newEntity = this.dailyRepo.create({
      id: uuidv4(),
      date: today,
      gridSeed: `daily-${cstDateToDayKey(today)}`,
      grid: generated.grid,
      targetWords: generated.targetWords,
      potentialWords: generated.potentialWords,
      potentialCount: generated.potentialCount,
      size: generated.size,
      duration: 180,
      settled: false,
    })
    // try save, if duplicate due to race, return existing
    try {
      entity = await this.dailyRepo.save(newEntity)
    } catch {
      entity = (await this.dailyRepo.findOne({ where: { date: today } }))!
    }
    this.logger.log(`Daily challenge ensured for ${today}`)
    return entity
  }

  async settleDaily(dateStr: string): Promise<void> {
    const entity = await this.dailyRepo.findOne({ where: { date: dateStr } })
    if (!entity || entity.settled) return
    const dayKey = cstDateToDayKey(dateStr)
    const lbKey = `lb:daily:${dayKey}`
    const members = await this.redis.zrevrange(lbKey, 0, 99, 'WITHSCORES')
    // members is [member, score, member, score...] depending on ioredis version; handle
    const entries: Array<{ userId: number; score: number }> = []
    for (let i = 0; i < members.length; i += 2) {
      const member = members[i]
      const scoreStr = members[i + 1]
      if (member !== undefined && scoreStr !== undefined) {
        entries.push({ userId: parseInt(member, 10), score: parseInt(scoreStr, 10) })
      }
    }
    // award coins
    for (let i = 0; i < entries.length; i++) {
      const rank = i + 1
      let coins = 0
      if (rank === 1) coins = 500
      else if (rank <= 10) coins = 200
      else coins = 100
      await this.userRepo.increment({ id: entries[i].userId }, 'coins', coins).catch(() => {})
    }
    // archive snapshots
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      const rank = i + 1
      try {
        await this.snapshotRepo.save(
          this.snapshotRepo.create({
            type: 'daily',
            period: dayKey,
            userId: e.userId,
            score: e.score,
            rank,
          }),
        )
      } catch {
        // unique violation ignore
      }
    }
    await this.redis.del(lbKey)
    entity.settled = true
    await this.dailyRepo.save(entity)
    this.logger.log(`Settled daily ${dateStr} with ${entries.length} entries`)
  }

  async settleSeason(monthStr: string): Promise<void> {
    const lbKey = `lb:season:${monthStr}`
    const members = await this.redis.zrevrange(lbKey, 0, 99, 'WITHSCORES')
    const entries: Array<{ userId: number; score: number }> = []
    for (let i = 0; i < members.length; i += 2) {
      const member = members[i]
      const scoreStr = members[i + 1]
      if (member !== undefined && scoreStr !== undefined) {
        entries.push({ userId: parseInt(member, 10), score: parseInt(scoreStr, 10) })
      }
    }
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      const rank = i + 1
      try {
        await this.snapshotRepo.save(
          this.snapshotRepo.create({
            type: 'season',
            period: monthStr,
            userId: e.userId,
            score: e.score,
            rank,
          }),
        )
      } catch {}
    }
    if (entries.length > 0) await this.redis.del(lbKey)
    this.logger.log(`Settled season ${monthStr} with ${entries.length} entries`)
  }

  async getDailyInfo(userId: number): Promise<{
    date: string
    size: number
    duration: number
    attemptsUsed: number
    attemptsLeft: number
    myBest: number | null
  }> {
    const entity = await this.ensureToday()
    const today = entity.date
    const attempts = await this.attemptRepo.find({ where: { date: today, userId } })
    const attemptsUsed = attempts.length
    const myBest = attempts.length > 0 ? Math.max(...attempts.map((a) => a.score)) : null
    return {
      date: today,
      size: entity.size,
      duration: entity.duration,
      attemptsUsed,
      attemptsLeft: Math.max(0, 3 - attemptsUsed),
      myBest,
    }
  }

  async startDaily(userId: number): Promise<{
    matchSessionId: string
    grid: string[][]
    size: number
    duration: number
    date: string
    attemptsLeft: number
  }> {
    const entity = await this.ensureToday()
    const today = entity.date
    const attemptsUsed = await this.attemptRepo.count({ where: { date: today, userId } })
    // soft check, hard check at submit; allow start even if 3 but will fail at submit
    // but if already 3, we can still allow viewing? We'll allow but submit will block.
    const raw = {
      id: entity.gridSeed,
      grid: entity.grid,
      targetWords: entity.targetWords,
      potentialWords: entity.potentialWords,
      potentialCount: entity.potentialCount,
      size: entity.size,
    }
    const res = await this.gameService.createSessionFromRaw(raw, userId, entity.duration)
    await this.redis.hset(`match_session:${res.matchSessionId}`, {
      dailyDate: today,
      isDailyMode: '1',
    })
    const attemptsLeft = Math.max(0, 3 - attemptsUsed - 1) // after this start, one will be used on submit
    // For UI, show attemptsLeft before submit? Use 3 - attemptsUsed
    return {
      matchSessionId: res.matchSessionId,
      grid: res.grid,
      size: res.size,
      duration: res.duration,
      date: today,
      attemptsLeft: Math.max(0, 3 - attemptsUsed),
    }
  }

  async submitDaily(
    userId: number,
    matchSessionId: string,
  ): Promise<{
    saved: boolean
    score: number
    attemptsLeft: number
    myBest: number
    maxCombo: number
    foundCount: number
    foundWords: Array<{ word: string; score: number; rarity: string }>
  }> {
    const session = await this.redis.hgetall(`match_session:${matchSessionId}`)
    if (!session || !session.grid) throw new NotFoundException('对局会话不存在或已过期')
    const sessionUserId = parseInt(session.userId || '0', 10)
    if (sessionUserId !== userId) throw new ForbiddenException('会话不属于当前用户')
    const today = cstDateStr()
    // verify session is daily and for today
    if (session.gridUuid !== `daily-${cstDateToDayKey(today)}` || session.dailyDate !== today) {
      // if session dailyDate mismatches today, check if session belongs to today entity's gridSeed
      const entity = await this.dailyRepo.findOne({ where: { date: today } })
      if (!entity || session.gridUuid !== entity.gridSeed) {
        throw new BadRequestException('非今日每日挑战会话')
      }
    }
    // 3 times limit
    const attemptsCount = await this.attemptRepo.count({ where: { date: today, userId } })
    if (attemptsCount >= 3) {
      throw new BadRequestException('今日挑战次数已用完')
    }
    // idempotent
    const existing = await this.attemptRepo.findOne({
      where: { date: today, userId, matchSessionId },
    })
    if (existing) {
      const all = await this.attemptRepo.find({ where: { date: today, userId } })
      const myBest = Math.max(...all.map((a) => a.score))
      return {
        saved: true,
        score: existing.score,
        attemptsLeft: Math.max(0, 3 - all.length),
        myBest,
        maxCombo: existing.maxCombo,
        foundCount: existing.foundCount,
        foundWords: [],
      }
    }
    const result = await this.gameService.endGame(matchSessionId)
    const attempt = this.attemptRepo.create({
      date: today,
      userId,
      score: result.score,
      maxCombo: result.maxCombo,
      foundCount: result.foundWords.length,
      matchSessionId,
    })
    await this.attemptRepo.save(attempt)
    // update leaderboards: daily and season with max logic
    const dayKey = cstDateToDayKey(today)
    const monthKey = cstMonthStr(new Date())
    await this.updateLeaderboard(`lb:daily:${dayKey}`, userId, result.score)
    await this.updateLeaderboard(`lb:season:${monthKey}`, userId, result.score)
    const allAfter = await this.attemptRepo.find({ where: { date: today, userId } })
    const myBest = Math.max(...allAfter.map((a) => a.score))
    return {
      saved: true,
      score: result.score,
      attemptsLeft: Math.max(0, 3 - allAfter.length),
      myBest,
      maxCombo: result.maxCombo,
      foundCount: result.foundWords.length,
      foundWords: result.foundWords,
    }
  }

  private async updateLeaderboard(key: string, userId: number, score: number): Promise<void> {
    try {
      const cur = await this.redis.zscore(key, userId.toString())
      const curNum = cur ? parseInt(cur, 10) : null
      if (curNum === null || score > curNum) {
        await this.redis.zadd(key, score.toString(), userId.toString())
      }
    } catch {}
  }
}
