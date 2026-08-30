import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Inject } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { REDIS_TOKEN } from '../common/redis.module'
import { GameService } from '../game/game.service'
import { UserEntity } from '../user/user.entity'
import { ChallengeEntity } from './challenge.entity'
import { ChallengeAttemptEntity } from './challenge-attempt.entity'

@Injectable()
export class ChallengeService {
  constructor(
    private readonly gameService: GameService,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    @InjectRepository(ChallengeEntity)
    private readonly challengeRepo: Repository<ChallengeEntity>,
    @InjectRepository(ChallengeAttemptEntity)
    private readonly attemptRepo: Repository<ChallengeAttemptEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  async create(userId: number, matchSessionId: string): Promise<{ challengeId: string }> {
    const session = await this.redis.hgetall(`match_session:${matchSessionId}`)
    if (!session || !session.grid) {
      throw new NotFoundException('对局会话不存在或已过期')
    }
    const sessionUserId = parseInt(session.userId || '0', 10)
    if (sessionUserId !== userId) {
      throw new ForbiddenException('无权使用该会话创建挑战')
    }
    const grid = JSON.parse(session.grid) as string[][]
    const size = grid.length
    const gridSeed = session.gridUuid || `challenge-${uuidv4()}`
    const targetWords = session.targetWords ? (JSON.parse(session.targetWords) as string[]) : []
    const potentialWords = session.potentialWords ? (JSON.parse(session.potentialWords) as string[]) : []
    const potentialCount = parseInt(session.potentialCount || '0', 10)
    const score = parseInt(session.score || '0', 10)

    const user = await this.userRepo.findOne({ where: { id: userId } })
    const entity = this.challengeRepo.create({
      id: uuidv4(),
      gridSeed,
      grid,
      targetWords,
      potentialWords,
      potentialCount,
      size,
      duration: 180,
      challengerId: userId,
      challengerScore: score,
      challengerNickname: user?.nickname ?? `玩家${userId}`,
      attempts: 0,
      bestScore: 0,
      bestUserId: null,
    })
    await this.challengeRepo.save(entity)
    return { challengeId: entity.id }
  }

  async getDetail(challengeId: string, viewerUserId: number): Promise<{
    id: string
    gridSeed: string
    duration: number
    challenger: { userId: number; nickname: string; score: number }
    stats: { attemptCount: number; bestScore: number; bestNickname: string | null }
    myBest: number | null
    beatChallenger: boolean
  }> {
    const ch = await this.challengeRepo.findOne({ where: { id: challengeId } })
    if (!ch) throw new NotFoundException('挑战不存在')
    let bestNickname: string | null = null
    if (ch.bestUserId) {
      const u = await this.userRepo.findOne({ where: { id: Number(ch.bestUserId) } })
      bestNickname = u?.nickname ?? `玩家${ch.bestUserId}`
    }
    let myBest: number | null = null
    let beat = false
    if (viewerUserId) {
      const myAttempts = await this.attemptRepo.find({
        where: { challengeId, userId: viewerUserId },
      })
      if (myAttempts.length > 0) {
        myBest = Math.max(...myAttempts.map((a) => a.score))
        beat = myBest > ch.challengerScore
      }
    }
    return {
      id: ch.id,
      gridSeed: ch.gridSeed,
      duration: ch.duration,
      challenger: {
        userId: Number(ch.challengerId),
        nickname: ch.challengerNickname ?? `玩家${ch.challengerId}`,
        score: ch.challengerScore,
      },
      stats: {
        attemptCount: ch.attempts,
        bestScore: ch.bestScore,
        bestNickname,
      },
      myBest,
      beatChallenger: beat,
    }
  }

  async start(challengeId: string, userId: number): Promise<{
    matchSessionId: string
    grid: string[][]
    size: number
    duration: number
    challenger: { nickname: string; score: number }
  }> {
    const ch = await this.challengeRepo.findOne({ where: { id: challengeId } })
    if (!ch) throw new NotFoundException('挑战不存在')
    const raw = {
      id: ch.gridSeed,
      grid: ch.grid,
      targetWords: ch.targetWords,
      potentialWords: ch.potentialWords,
      potentialCount: ch.potentialCount,
      size: ch.size,
    }
    const res = await this.gameService.createSessionFromRaw(raw, userId, ch.duration)
    await this.redis.hset(`match_session:${res.matchSessionId}`, {
      challengeId: ch.id,
      isChallengeMode: '1',
    })
    return {
      matchSessionId: res.matchSessionId,
      grid: res.grid,
      size: res.size,
      duration: res.duration,
      challenger: {
        nickname: ch.challengerNickname ?? `玩家${ch.challengerId}`,
        score: ch.challengerScore,
      },
    }
  }

  async submit(
    challengeId: string,
    userId: number,
    matchSessionId: string,
  ): Promise<{
    saved: boolean
    beat: boolean
    my: { score: number; maxCombo: number; foundCount: number; foundWords: Array<{ word: string; score: number; rarity: string }> }
    challenger: { nickname: string; score: number }
    rank: number
  }> {
    const ch = await this.challengeRepo.findOne({ where: { id: challengeId } })
    if (!ch) throw new NotFoundException('挑战不存在')
    const session = await this.redis.hgetall(`match_session:${matchSessionId}`)
    if (!session || !session.grid) throw new NotFoundException('对局会话不存在或已过期')
    const sessionUserId = parseInt(session.userId || '0', 10)
    if (sessionUserId !== userId) throw new ForbiddenException('会话不属于当前用户')
    if (session.gridUuid !== ch.gridSeed) {
      throw new BadRequestException('网格不匹配')
    }
    // 幂等
    const existing = await this.attemptRepo.findOne({
      where: { challengeId, matchSessionId },
    })
    if (existing) {
      const rank = await this.getRank(challengeId, existing.score)
      return {
        saved: true,
        beat: existing.beat,
        my: {
          score: existing.score,
          maxCombo: existing.maxCombo,
          foundCount: existing.foundCount,
          foundWords: [],
        },
        challenger: {
          nickname: ch.challengerNickname ?? `玩家${ch.challengerId}`,
          score: ch.challengerScore,
        },
        rank,
      }
    }

    const result = await this.gameService.endGame(matchSessionId)
    const beat = result.score > ch.challengerScore
    const attempt = this.attemptRepo.create({
      challengeId,
      userId,
      matchSessionId,
      score: result.score,
      maxCombo: result.maxCombo,
      foundCount: result.foundWords.length,
      beat,
    })
    await this.attemptRepo.save(attempt)
    // update challenge stats
    ch.attempts += 1
    if (result.score > ch.bestScore) {
      ch.bestScore = result.score
      ch.bestUserId = userId
    }
    await this.challengeRepo.save(ch)
    const rank = await this.getRank(challengeId, result.score)
    return {
      saved: true,
      beat,
      my: {
        score: result.score,
        maxCombo: result.maxCombo,
        foundCount: result.foundWords.length,
        foundWords: result.foundWords,
      },
      challenger: {
        nickname: ch.challengerNickname ?? `玩家${ch.challengerId}`,
        score: ch.challengerScore,
      },
      rank,
    }
  }

  private async getRank(challengeId: string, score: number): Promise<number> {
    const count = await this.attemptRepo
      .createQueryBuilder('a')
      .where('a.challengeId = :challengeId', { challengeId })
      .andWhere('a.score > :score', { score })
      .getCount()
    return count + 1
  }

  async mine(userId: number): Promise<{
    challenges: Array<{
      challengeId: string
      createdAt: string
      challengerScore: number
      attemptCount: number
      bestScore: number
      bestNickname: string | null
      beaten: boolean
    }>
  }> {
    const list = await this.challengeRepo.find({
      where: { challengerId: userId },
      order: { createdAt: 'DESC' },
    })
    const challenges = await Promise.all(
      list.map(async (ch) => {
        let bestNickname: string | null = null
        if (ch.bestUserId) {
          const u = await this.userRepo.findOne({ where: { id: Number(ch.bestUserId) } })
          bestNickname = u?.nickname ?? `玩家${ch.bestUserId}`
        }
        return {
          challengeId: ch.id,
          createdAt: ch.createdAt.toISOString(),
          challengerScore: ch.challengerScore,
          attemptCount: ch.attempts,
          bestScore: ch.bestScore,
          bestNickname,
          beaten: ch.bestScore > ch.challengerScore,
        }
      }),
    )
    return { challenges }
  }
}
