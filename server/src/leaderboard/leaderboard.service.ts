import { Injectable, Inject } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, In } from 'typeorm'
import Redis from 'ioredis'
import { REDIS_TOKEN } from '../common/redis.module'
import { UserEntity } from '../user/user.entity'
import { cstDateStr, cstMonthStr, cstDateToDayKey } from '../common/time'

@Injectable()
export class LeaderboardService {
  constructor(
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  async get(
    userId: number,
    type: string,
  ): Promise<{
    type: string
    period: string
    mine: { userId: number; nickname: string; score: number; rank: number } | null
    list: Array<{ userId: number; nickname: string; score: number }>
  }> {
    const t = type || 'daily'
    let key = ''
    let period = ''
    if (t === 'daily') {
      const dayKey = cstDateToDayKey(cstDateStr())
      key = `lb:daily:${dayKey}`
      period = dayKey
    } else if (t === 'season') {
      const monthKey = cstMonthStr(new Date())
      key = `lb:season:${monthKey}`
      period = monthKey
    } else {
      key = 'lb:all'
      period = 'all'
    }

    const raw = await this.redis.zrevrange(key, 0, 49, 'WITHSCORES')
    const entries: Array<{ userId: number; score: number }> = []
    for (let i = 0; i < raw.length; i += 2) {
      const member = raw[i]
      const scoreStr = raw[i + 1]
      if (member !== undefined && scoreStr !== undefined) {
        entries.push({ userId: parseInt(member, 10), score: parseInt(scoreStr, 10) })
      }
    }

    let mine: { userId: number; nickname: string; score: number; rank: number } | null = null
    const myScoreStr = await this.redis.zscore(key, userId.toString())
    if (myScoreStr !== null) {
      const rankRaw = await this.redis.zrevrank(key, userId.toString())
      const rank = rankRaw !== null ? rankRaw + 1 : -1
      const nickname = await this.getNickname(userId)
      mine = {
        userId,
        nickname,
        score: parseInt(myScoreStr, 10),
        rank,
      }
    }

    // batch fetch nicknames for list
    const userIds = entries.map((e) => e.userId)
    const users = userIds.length > 0 ? await this.userRepo.find({ where: { id: In(userIds) } }) : []
    const nickMap = new Map<number, string>()
    for (const u of users) {
      nickMap.set(Number(u.id), u.nickname ?? `玩家${u.id}`)
    }
    const list = entries.map((e) => ({
      userId: e.userId,
      nickname: nickMap.get(e.userId) ?? `玩家${e.userId}`,
      score: e.score,
    }))

    return { type: t, period, mine, list }
  }

  private async getNickname(userId: number): Promise<string> {
    const u = await this.userRepo.findOne({ where: { id: userId } })
    return u?.nickname ?? `玩家${userId}`
  }
}
