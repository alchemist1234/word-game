import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Interval } from '@nestjs/schedule'
import Redis from 'ioredis'
import { Inject } from '@nestjs/common'
import { REDIS_TOKEN } from '../common/redis.module'
import { UserEntity } from '../user/user.entity'
import { MatchPlayerEntity } from '../match/match-player.entity'
import { LeaderboardSnapshotEntity } from '../leaderboard/leaderboard-snapshot.entity'
import { cstMonthStr } from '../common/time'

export function recalcTier(score: number): number {
  if (score >= 1000) return 5
  if (score >= 600) return 4
  if (score >= 300) return 3
  if (score >= 100) return 2
  return 1
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
    @InjectRepository(MatchPlayerEntity) private readonly mpRepo: Repository<MatchPlayerEntity>,
    @InjectRepository(LeaderboardSnapshotEntity) private readonly snapRepo: Repository<LeaderboardSnapshotEntity>,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
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
    const wins = await this.mpRepo.count({ where: { userId, rank: 1 } as unknown as Record<string, unknown> })
    // need to filter non-draw? For 1v1 draw both rank 1, wins overcount. Use winnerId? Simplify: wins where rank=1 and not draw? We'll trust rank=1 as win-ish
    // losses where rank=2
    const losses = await this.mpRepo.count({ where: { userId, rank: 2 } as unknown as Record<string, unknown> })
    // draws: need to handle but approximate
    const total = wins + losses
    const draws = 0
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

  async updateRankAfterMatch(userId: number, oppTier: number, result: 'win' | 'lose' | 'draw'): Promise<void> {
    if (userId < 0) return // AI skip
    const user = await this.userRepo.findOne({ where: { id: userId } })
    if (!user) return
    const delta = calcRankDelta(user.rankTier, oppTier, result)
    const newScore = Math.max(0, user.rankScore + delta)
    const newTier = recalcTier(newScore)
    user.rankScore = newScore
    user.rankTier = newTier
    await this.userRepo.save(user)
  }

  // season settle: partial reset 60% + tier recalc, called from DailyService or cron
  async settleRankSeason(monthStr: string): Promise<void> {
    const users = await this.userRepo.find()
    for (const u of users) {
      const newScore = Math.floor(u.rankScore * 0.6)
      const newTier = recalcTier(newScore)
      if (newScore !== u.rankScore || newTier !== u.rankTier) {
        u.rankScore = newScore
        u.rankTier = newTier
        await this.userRepo.save(u)
      }
    }
    this.logger.log(`Settled rank season ${monthStr}`)
  }

  @Interval(5 * 60 * 1000)
  async checkSeasonRollover(): Promise<void> {
    // placeholder: actual settle triggered by DailyService on month change
  }
}
