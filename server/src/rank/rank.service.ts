import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, In, Repository } from 'typeorm'
import { Interval } from '@nestjs/schedule'
import Redis from 'ioredis'
import { Inject } from '@nestjs/common'
import { REDIS_TOKEN } from '../common/redis.module'
import { UserEntity } from '../user/user.entity'
import { MatchEntity } from '../match/match.entity'
import { MatchPlayerEntity } from '../match/match-player.entity'
import { LeaderboardSnapshotEntity } from '../leaderboard/leaderboard-snapshot.entity'
import { cstDateStr, cstMonthStr } from '../common/time'
import { UPDATE_LEADERBOARD_SCRIPT } from '../game/redis-scripts'
import { SeasonSettlementEntity } from './season-settlement.entity'
import { AchievementService } from '../achievement/achievement.service'

/**
 * 1..5 为按分数晋级的段位，6/7 为赛季结算时按月榜百分位授予。
 * percentile 越小名次越靠前（0.01 = 前 1%）。
 */
export function recalcTier(score: number, percentile?: number): number {
  const baseTier = score >= 1000 ? 5 : score >= 600 ? 4 : score >= 300 ? 3 : score >= 100 ? 2 : 1
  if (percentile !== undefined && percentile <= 0.01) return 7
  if (percentile !== undefined && percentile <= 0.1) return 6
  return baseTier
}

export function calcRankDelta(myTier: number, oppTier: number, result: 'win' | 'lose' | 'draw'): number {
  const diff = oppTier - myTier
  if (result === 'win') {
    return Math.max(10, 20 + diff * 2)
  }
  if (result === 'lose') {
    return Math.max(-15, -10 + diff) // negative
  }
  return result === 'draw' ? 5 : 0
}

@Injectable()
export class RankService {
  private readonly logger = new Logger(RankService.name)
  constructor(
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(MatchEntity) private readonly matchRepo: Repository<MatchEntity>,
    @InjectRepository(MatchPlayerEntity) private readonly mpRepo: Repository<MatchPlayerEntity>,
    @InjectRepository(LeaderboardSnapshotEntity) private readonly snapRepo: Repository<LeaderboardSnapshotEntity>,
    @InjectRepository(SeasonSettlementEntity) private readonly seasonRepo: Repository<SeasonSettlementEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    private readonly achievementService: AchievementService,
  ) {}

  async getRankMe(userId: number): Promise<{
    rankTier: number
    rankScore: number
    wins: number
    losses: number
    draws: number
    winRate: number
    season: string
  }> {
    const user = await this.userRepo.findOne({ where: { id: userId } })
    const season = cstMonthStr(new Date())
    const playerRows = await this.mpRepo.find({ where: { userId, isAi: false } })
    const matchIds = [...new Set(playerRows.map((row) => row.matchId))]
    const matches = matchIds.length > 0
      ? await this.matchRepo.find({ where: { id: In(matchIds) } })
      : []
    const matchById = new Map(matches.map((match) => [match.id, match]))
    let wins = 0
    let losses = 0
    let draws = 0
    for (const row of playerRows) {
      const match = matchById.get(row.matchId)
      if (!match || match.status === 'ongoing' || match.mode !== 'ranked') continue
      // winnerId 为空表示平局；4p 中只有最终 winnerId 计胜，其余计负。
      if (match.winnerId === null) draws += 1
      else if (match.winnerId === userId) wins += 1
      else losses += 1
    }
    const total = wins + losses
    const winRate = total > 0 ? Math.round((wins / total) * 100) / 100 : 0
    return {
      rankTier: user?.rankTier ?? 1,
      rankScore: user?.rankScore ?? 0,
      wins,
      losses,
      draws,
      winRate,
      season,
    }
  }

  async updateRankAfterMatch(
    userId: number,
    oppTier: number,
    result: 'win' | 'lose' | 'draw',
    score = 0,
  ): Promise<void> {
    if (userId < 0) return // AI skip
    const newTier = await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(UserEntity, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!user) return null
      const delta = calcRankDelta(user.rankTier, oppTier, result)
      const newScore = user.rankScore + delta
      const tier = user.rankTier >= 6 ? user.rankTier : recalcTier(newScore)
      user.rankScore = newScore
      user.rankTier = tier
      await manager.save(user)
      return tier
    })
    if (newTier === null) return
    await this.redis.eval(
      UPDATE_LEADERBOARD_SCRIPT,
      1,
      `lb:ranked:${cstMonthStr(new Date())}`,
      userId.toString(),
      Math.max(0, score).toString(),
    )
    try {
      await this.achievementService.check(userId, 'rank', { tier: newTier })
    } catch (error) {
      this.logger.warn(`rank achievement check failed: ${(error as Error).message}`)
    }
  }

  async getRankLeaderboard(userId: number, season?: string): Promise<{
    season: string
    mine: { userId: number; nickname: string; score: number; rank: number; rankTier: number } | null
    list: Array<{ userId: number; nickname: string; score: number; rankTier: number }>
  }> {
    const period = season || cstMonthStr(new Date())
    if (!/^\d{6}$/.test(period)) {
      throw new BadRequestException('INVALID_SEASON')
    }
    const key = `lb:ranked:${period}`
    const raw = await this.redis.zrevrange(key, 0, 49, 'WITHSCORES')
    const entries: Array<{ userId: number; score: number; rank: number }> = []
    for (let i = 0; i < raw.length; i += 2) {
      const member = raw[i]
      const score = raw[i + 1]
      if (member !== undefined && score !== undefined) {
        entries.push({
          userId: Number.parseInt(member, 10),
          score: Number.parseInt(score, 10),
          rank: Math.floor(i / 2) + 1,
        })
      }
    }
    const userIds = [...new Set([userId, ...entries.map((entry) => entry.userId)])]
    const users = userIds.length > 0
      ? await this.userRepo.find({ where: { id: In(userIds) } })
      : []
    const userMap = new Map(users.map((user) => [Number(user.id), user]))
    const list = entries.map((entry) => {
      const user = userMap.get(entry.userId)
      return {
        userId: entry.userId,
        nickname: user?.nickname ?? `玩家${entry.userId}`,
        score: entry.score,
        rankTier: user?.rankTier ?? 1,
      }
    })
    const mineScore = await this.redis.zscore(key, userId.toString())
    let mine: { userId: number; nickname: string; score: number; rank: number; rankTier: number } | null = null
    if (mineScore !== null) {
      const mineRankRaw = await this.redis.zrevrank(key, userId.toString())
      const user = userMap.get(userId)
      mine = {
        userId,
        nickname: user?.nickname ?? `玩家${userId}`,
        score: Number.parseInt(mineScore, 10),
        rank: mineRankRaw === null ? -1 : mineRankRaw + 1,
        rankTier: user?.rankTier ?? 1,
      }
    }
    return { season: period, mine, list }
  }

  // 赛季结算：按月榜名次授予 6/7 档，保留 60% 排位分，并发放一次奖励。
  async settleRankSeason(monthStr: string): Promise<void> {
    const alreadySettled = await this.seasonRepo.findOne({ where: { period: monthStr } })
    if (alreadySettled) {
      this.logger.log(`Rank season ${monthStr} already settled`)
      return
    }
    try {
      await this.dataSource.transaction(async (manager) => {
        // 先抢占唯一 period；并发 cron 只有一方能进入奖励循环。
        await manager.save(
          manager.create(SeasonSettlementEntity, {
            period: monthStr,
            userCount: 0,
          }),
        )
        const users = await manager.find(UserEntity)
        const ranked = [...users].sort((a, b) => b.rankScore - a.rankScore)
        for (let index = 0; index < ranked.length; index += 1) {
          const user = ranked[index]
          const percentile = ranked.length > 0 ? (index + 1) / ranked.length : 1
          const newScore = Math.floor(user.rankScore * 0.6)
          const newTier = recalcTier(newScore, percentile)
          let coinReward = 0
          let diamondReward = 0
          if (percentile <= 0.01 || user.rankTier === 7) {
            diamondReward = 500
          } else if (percentile <= 0.1 || user.rankTier === 6) {
            diamondReward = 200
          } else if (user.rankTier === 5) {
            diamondReward = 100
          } else {
            coinReward = 200
          }
          user.rankScore = newScore
          user.rankTier = newTier
          user.coins += coinReward
          user.diamonds += diamondReward
          await manager.save(user)
        }
        await manager.update(
          SeasonSettlementEntity,
          { period: monthStr },
          { userCount: ranked.length },
        )
        this.logger.log(
          `Settled rank season ${monthStr}: users=${ranked.length}, top=${ranked[0]?.rankScore ?? 0}`,
        )
      })
    } catch (error) {
      // 唯一键竞争表示另一实例已完成；其他错误继续上抛给监控/补偿任务。
      const raced = await this.seasonRepo.findOne({ where: { period: monthStr } })
      if (!raced) throw error
      this.logger.log(`Rank season ${monthStr} settled by another worker`)
    }
  }

  @Interval(5 * 60 * 1000)
  async checkSeasonRollover(): Promise<void> {
    const today = cstDateStr(new Date())
    if (!today.endsWith('-01')) return
    const previous = cstMonthStr(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000))
    const current = cstMonthStr(new Date())
    if (previous !== current) {
      await this.settleRankSeason(previous).catch((error: unknown) => {
        this.logger.warn(`rank season rollover failed: ${String(error)}`)
      })
    }
  }
}
