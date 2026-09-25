import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { WebSocket } from 'ws'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { REDIS_TOKEN } from '../common/redis.module'
import { GameService } from '../game/game.service'
import { GridPoolService } from '../grid-pool/grid-pool.service'
import { UserEntity } from '../user/user.entity'
import { MatchEntity } from './match.entity'
import { MatchPlayerEntity } from './match-player.entity'
import { decideWinner, type PlayerStats } from './match-decision'
import { AiService } from '../ai/ai.service'
import { RankService } from '../rank/rank.service'
import { AchievementService } from '../achievement/achievement.service'
import { EconomyService } from '../economy/economy.service'
import { SUBMIT_WORD_SCRIPT } from '../game/redis-scripts'

const QUEUE_TIMEOUT_MS = 30000
const DISCONNECT_GRACE_MS = 30000
const MATCH_DURATION = 180
const COUNTDOWN_SEC = 3
const MATCH_TIERS = [1, 2, 3, 4, 5, 6, 7]
const SESSION_TTL = 600
const COMBO_WINDOW_MS = 10000
const MAX_COMBO = 10
const QUEUE_LOCK_TTL_SECONDS = 10
type MatchMode = 'casual' | 'ranked'

const RELEASE_QUEUE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

const ENQUEUE_QUEUE_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('HSET', KEYS[2], 'tier', ARGV[2], 'enqueuedAt', ARGV[3], 'mode', ARGV[4])
return 1
`

const CLAIM_QUEUE_META_SCRIPT = `
local token = redis.call('HGET', KEYS[1], 'claimToken')
local claimedAt = tonumber(redis.call('HGET', KEYS[1], 'claimedAt'))
if token and claimedAt and tonumber(ARGV[2]) - claimedAt < tonumber(ARGV[3]) then
  return 0
end
redis.call('HSET', KEYS[1], 'claimToken', ARGV[1], 'claimedAt', ARGV[2])
return 1
`

const RELEASE_QUEUE_META_SCRIPT = `
if redis.call('HGET', KEYS[1], 'claimToken') == ARGV[1] then
  redis.call('HDEL', KEYS[1], 'claimToken', 'claimedAt')
  return 1
end
return 0
`

interface RoomPlayer {
  sid: string
  clientConnected: boolean
  disconnectTimer?: NodeJS.Timeout
  isAi: boolean
  aiLevel?: string
}

interface MatchRoom {
  matchId: string
  type: 'pvp_1v1' | 'pvp_4p'
  mode: MatchMode
  grid: string[][]
  size: number
  duration: number
  players: Map<number, RoomPlayer>
  status: 'countdown' | 'playing' | 'finished'
  remainingSec: number
  ticker?: NodeJS.Timeout
  lastScores: Map<number, number>
  lastMatchEnd?: unknown
  aiTimers: Map<number, NodeJS.Timeout>
  aiPools: Map<number, Array<{ word: string; rarity: string; length: number; score: number }>>
  aiIndices: Map<number, number>
  aiCombo: Map<number, number>
}

@Injectable()
export class MatchService implements OnModuleDestroy {
  private readonly logger = new Logger(MatchService.name)
  private readonly rooms = new Map<string, MatchRoom>()
  private readonly playerMatch = new Map<number, string>()
  private readonly userClients = new Map<number, WebSocket>()
  private aiIdSeq = -1

  registerClient(userId: number, client: WebSocket): void {
    this.userClients.set(userId, client)
  }
  isCurrentClient(userId: number, client: WebSocket): boolean {
    return this.userClients.get(userId) === client
  }
  unregisterClient(userId: number, client: WebSocket): void {
    if (this.userClients.get(userId) === client) this.userClients.delete(userId)
  }
  broadcastToUser(userId: number, event: string, data: unknown): void {
    if (userId < 0) return
    const client = this.userClients.get(userId)
    if (client && client.readyState === 1) client.send(JSON.stringify({ event, data }))
  }

  constructor(
    private readonly gameService: GameService,
    private readonly gridPoolService: GridPoolService,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(MatchEntity) private readonly matchRepo: Repository<MatchEntity>,
    @InjectRepository(MatchPlayerEntity) private readonly matchPlayerRepo: Repository<MatchPlayerEntity>,
    private readonly aiService: AiService,
    private readonly rankService: RankService,
    private readonly achievementService: AchievementService,
    private readonly economyService: EconomyService,
  ) {}

  private normalizeMode(mode?: string): MatchMode {
    return mode === 'ranked' ? 'ranked' : 'casual'
  }

  private async acquireQueueLock(key: string): Promise<string | null> {
    const token = uuidv4()
    const acquired = await this.redis.set(
      key,
      token,
      'EX',
      QUEUE_LOCK_TTL_SECONDS,
      'NX',
    )
    return acquired === 'OK' ? token : null
  }

  private async releaseQueueLock(key: string, token: string): Promise<void> {
    try {
      await this.redis.eval(RELEASE_QUEUE_LOCK_SCRIPT, 1, key, token)
    } catch (error) {
      this.logger.warn(`release queue lock failed: ${(error as Error).message}`)
    }
  }

  private async claimQueueUser(metaKey: string, token: string): Promise<boolean> {
    const result = await this.redis.eval(
      CLAIM_QUEUE_META_SCRIPT,
      1,
      metaKey,
      token,
      Date.now().toString(),
      (30 * 1000).toString(),
    )
    return Number(result) === 1
  }

  private async releaseQueueUser(metaKey: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_QUEUE_META_SCRIPT, 1, metaKey, token)
  }

  onModuleDestroy(): void {
    for (const room of this.rooms.values()) {
      if (room.ticker) clearInterval(room.ticker)
      for (const t of room.aiTimers.values()) clearTimeout(t)
      for (const [, p] of room.players) if (p.disconnectTimer) clearTimeout(p.disconnectTimer)
    }
  }

  // ===== 匹配队列 (1v1 + 4p) =====

  async queue(userId: number, opts?: { size?: number; mode?: string }): Promise<{ status: string; matchId?: string }> {
    const size = opts?.size === 4 ? 4 : 2
    const mode = this.normalizeMode(opts?.mode)
    const existing = this.playerMatch.get(userId)
    if (existing) {
      const room = this.rooms.get(existing)
      if (room && room.status !== 'finished') return { status: 'matched', matchId: existing }
      this.leaveMatch(userId, existing)
    }
    await this.cancelQueue(userId)
    await this.cancelQueue4p(userId)
    const user = await this.userRepo.findOne({ where: { id: userId } })
    const tier = Math.min(Math.max(user?.rankTier ?? 1, 1), 7)
    if (size === 4) {
      const queueKey = `match_queue_4p:${mode}:${tier}`
      const metaKey = `match_queue_4p_meta:${userId}`
      await this.redis.eval(
        ENQUEUE_QUEUE_SCRIPT,
        2,
        queueKey,
        metaKey,
        userId.toString(),
        tier.toString(),
        Date.now().toString(),
        mode,
      )
      await this.tryPairQueue4p(tier, mode)
    } else {
      const queueKey = `match_queue:${mode}:${tier}`
      const metaKey = `match_queue_meta:${userId}`
      await this.redis.eval(
        ENQUEUE_QUEUE_SCRIPT,
        2,
        queueKey,
        metaKey,
        userId.toString(),
        tier.toString(),
        Date.now().toString(),
        mode,
      )
      await this.tryPairQueue(tier, mode)
    }
    return { status: 'queued' }
  }

  async queueStatus(userId: number, opts?: { size?: number; mode?: string }): Promise<{
    status: 'queued' | 'matched' | 'timeout'
    matchId?: string
    elapsedSec?: number
    grid?: string[][]
    size?: number
    duration?: number
    mySid?: string
    opponent?: { nickname: string; rankTier: number }
    players?: Array<{ userId: number; nickname: string; rankTier: number; isAi: boolean }>
  }> {
    const size = opts?.size === 4 ? 4 : 2
    if (size === 4) {
      const meta = await this.redis.hgetall(`match_queue_4p_meta:${userId}`)
      if (meta.tier) {
        const elapsed = Date.now() - parseInt(meta.enqueuedAt || '0', 10)
        // 4p no longer returns timeout; AI fills, so keep queued until matched
        if (elapsed > QUEUE_TIMEOUT_MS * 2) {
          // fallback to timeout if still queued very long (grid pool exhausted)
          // but normally AI will have filled
        }
        return { status: 'queued', elapsedSec: Math.floor(elapsed / 1000) }
      }
    } else {
      const meta = await this.redis.hgetall(`match_queue_meta:${userId}`)
      if (meta.tier) {
        const elapsed = Date.now() - parseInt(meta.enqueuedAt || '0', 10)
        // 8a: no longer timeout for 1v1; AI will take over, but keep queued feedback until matched
        // to preserve H5 UX, we still report queued until AI match created (scan will create)
        return { status: 'queued', elapsedSec: Math.floor(elapsed / 1000) }
      }
    }
    const matchId = this.playerMatch.get(userId)
    if (matchId) {
      const room = this.rooms.get(matchId)
      const player = room?.players.get(userId)
      if (room && player) {
        if (room.type === 'pvp_4p') {
          const players: Array<{ userId: number; nickname: string; rankTier: number; isAi: boolean }> = []
          for (const [uid] of room.players) {
            if (uid < 0) {
              const rp = room.players.get(uid)!
              players.push({ userId: uid, nickname: `AI-${rp.aiLevel}`, rankTier: 1, isAi: true })
            } else {
              const u = await this.userRepo.findOne({ where: { id: uid } })
              players.push({ userId: uid, nickname: u?.nickname ?? `玩家${uid}`, rankTier: u?.rankTier ?? 1, isAi: false })
            }
          }
          return { status: 'matched' as const, matchId, grid: room.grid, size: room.size, duration: room.duration, mySid: player.sid, players }
        }
        const opponentId = [...room.players.keys()].find((id) => id !== userId)
        let opponent: UserEntity | null = null
        if (opponentId !== undefined && opponentId > 0) opponent = await this.userRepo.findOne({ where: { id: opponentId } })
        const oppNickname = opponentId !== undefined && opponentId < 0 ? `AI-${room.players.get(opponentId!)?.aiLevel}` : (opponent?.nickname ?? `玩家${opponentId ?? ''}`)
        const oppTier = opponent?.rankTier ?? 1
        return {
          status: 'matched' as const,
          matchId,
          grid: room.grid,
          size: room.size,
          duration: room.duration,
          mySid: player.sid,
          opponent: { nickname: oppNickname, rankTier: oppTier },
        }
      }
      return { status: 'matched', matchId }
    }
    return { status: 'timeout' }
  }

  async cancelQueue(userId: number): Promise<{ cancelled: boolean }> {
    const meta = await this.redis.hgetall(`match_queue_meta:${userId}`)
    if (meta.tier) {
      const mode = this.normalizeMode(meta.mode)
      await this.redis.lrem(`match_queue:${mode}:${meta.tier}`, 0, userId.toString())
      await this.redis.del(`match_queue_meta:${userId}`)
      return { cancelled: true }
    }
    return { cancelled: false }
  }
  async cancelQueue4p(userId: number): Promise<{ cancelled: boolean }> {
    const meta = await this.redis.hgetall(`match_queue_4p_meta:${userId}`)
    if (meta.tier) {
      const mode = this.normalizeMode(meta.mode)
      await this.redis.lrem(`match_queue_4p:${mode}:${meta.tier}`, 0, userId.toString())
      await this.redis.del(`match_queue_4p_meta:${userId}`)
      return { cancelled: true }
    }
    return { cancelled: false }
  }

  async abandon(userId: number): Promise<void> {
    const matchId = this.playerMatch.get(userId)
    await this.cancelQueue(userId)
    await this.cancelQueue4p(userId)
    if (!matchId) return
    const room = this.rooms.get(matchId)
    const player = room?.players.get(userId)
    if (!room || room.status === 'finished' || !player) {
      this.playerMatch.delete(userId)
      room?.players.delete(userId)
      return
    }
    this.logger.warn(`Match ${matchId}: user ${userId} abandoned`)
    if (room.type === 'pvp_4p') {
      await this.finishMatch4p(matchId, userId, 'abandon')
    } else {
      await this.finishMatch(matchId, userId, 'abandon')
    }
  }

  @Interval(1000)
  async scanQueues(): Promise<void> {
    for (const mode of ['casual', 'ranked'] as const) {
      for (const tier of MATCH_TIERS) {
        await this.tryPairQueue(tier, mode)
        await this.tryPairQueue4p(tier, mode)
      }
    }
  }

  private async tryPairQueue(tier: number, mode: MatchMode): Promise<void> {
    const lockKey = `match-queue-lock:1v1:${mode}:${tier}`
    const lockToken = await this.acquireQueueLock(lockKey)
    if (!lockToken) return
    const key = `match_queue:${mode}:${tier}`
    const metaPrefix = 'match_queue_meta:'
    try {
      const ids = await this.redis.lrange(key, 0, -1)
      const picked: Array<{ uid: number; idStr: string; token: string }> = []
      for (const idStr of ids) {
        if (picked.length >= 2) break
        const uid = Number.parseInt(idStr, 10)
        if (!Number.isInteger(uid) || picked.some((entry) => entry.uid === uid)) continue
        const metaKey = `${metaPrefix}${uid}`
        const meta = await this.redis.hgetall(metaKey)
        if (!meta.tier) {
          await this.redis.lrem(key, 0, idStr)
          continue
        }
        const token = uuidv4()
        if (!(await this.claimQueueUser(metaKey, token))) continue
        picked.push({ uid, idStr, token })
      }
      if (picked.length >= 2) {
        const [a, b] = picked
        try {
          await this.setupMatch(a.uid, b.uid, mode)
          await this.redis.lrem(key, 0, a.idStr)
          await this.redis.lrem(key, 0, b.idStr)
          await this.redis.del(`${metaPrefix}${a.uid}`, `${metaPrefix}${b.uid}`)
        } catch (error) {
          this.logger.warn(`setupMatch failed: ${(error as Error).message}`)
          await this.releaseQueueUser(`${metaPrefix}${a.uid}`, a.token)
          await this.releaseQueueUser(`${metaPrefix}${b.uid}`, b.token)
        }
        return
      }
      if (picked.length === 1) {
        const entry = picked[0]
        const metaKey = `${metaPrefix}${entry.uid}`
        const meta = await this.redis.hgetall(metaKey)
        const elapsed = Date.now() - Number.parseInt(meta.enqueuedAt || '0', 10)
        if (elapsed > QUEUE_TIMEOUT_MS) {
          try {
            await this.setupMatchWithAi(entry.uid, mode)
            await this.redis.lrem(key, 0, entry.idStr)
            await this.redis.del(metaKey)
          } catch (error) {
            this.logger.warn(`setupMatchWithAi failed: ${(error as Error).message}`)
            await this.releaseQueueUser(metaKey, entry.token)
          }
        } else {
          await this.releaseQueueUser(metaKey, entry.token)
        }
        return
      }
      // 没有可 claim 的用户，或其他用户正在被 claim，保持队列不变。
      for (const entry of picked) {
        await this.releaseQueueUser(`${metaPrefix}${entry.uid}`, entry.token)
      }
    } finally {
      await this.releaseQueueLock(lockKey, lockToken)
    }
  }

  private async tryPairQueue4p(tier: number, mode: MatchMode): Promise<void> {
    const lockKey = `match-queue-lock:4p:${mode}:${tier}`
    const lockToken = await this.acquireQueueLock(lockKey)
    if (!lockToken) return
    const key = `match_queue_4p:${mode}:${tier}`
    const metaPrefix = 'match_queue_4p_meta:'
    try {
      const ids = await this.redis.lrange(key, 0, -1)
      const picked: Array<{ uid: number; idStr: string; token: string }> = []
      for (const idStr of ids) {
        if (picked.length >= 4) break
        const uid = Number.parseInt(idStr, 10)
        if (!Number.isInteger(uid) || picked.some((entry) => entry.uid === uid)) continue
        const metaKey = `${metaPrefix}${uid}`
        const meta = await this.redis.hgetall(metaKey)
        if (!meta.tier) {
          await this.redis.lrem(key, 0, idStr)
          continue
        }
        const token = uuidv4()
        if (!(await this.claimQueueUser(metaKey, token))) continue
        picked.push({ uid, idStr, token })
      }
      if (picked.length >= 4) {
        const userIds = picked.map((entry) => entry.uid)
        try {
          await this.setupMatch4p(userIds, undefined, mode)
          for (const entry of picked) await this.redis.lrem(key, 0, entry.idStr)
          for (const entry of picked) await this.redis.del(`${metaPrefix}${entry.uid}`)
        } catch (error) {
          this.logger.warn(`setupMatch4p failed: ${(error as Error).message}`)
          for (const entry of picked) {
            await this.releaseQueueUser(`${metaPrefix}${entry.uid}`, entry.token)
          }
        }
        return
      }
      if (picked.length === 0) return
      const firstMeta = await this.redis.hgetall(`${metaPrefix}${picked[0].uid}`)
      const elapsed = Date.now() - Number.parseInt(firstMeta.enqueuedAt || '0', 10)
      if (elapsed <= QUEUE_TIMEOUT_MS) {
        for (const entry of picked) {
          await this.releaseQueueUser(`${metaPrefix}${entry.uid}`, entry.token)
        }
        return
      }
      const userIds = picked.map((entry) => entry.uid)
      const avgTier = await this.avgTier(userIds)
      const aiLevel = this.aiService.levelForAvgTier(avgTier)
      const aiIds: number[] = []
      for (let i = userIds.length; i < 4; i += 1) aiIds.push(this.nextAiId())
      try {
        await this.setupMatch4p(
          [...userIds, ...aiIds],
          new Map(aiIds.map((id) => [id, aiLevel])),
          mode,
        )
        for (const entry of picked) await this.redis.lrem(key, 0, entry.idStr)
        for (const entry of picked) await this.redis.del(`${metaPrefix}${entry.uid}`)
      } catch (error) {
        this.logger.warn(`setupMatch4p AI fill failed: ${(error as Error).message}`)
        for (const entry of picked) {
          await this.releaseQueueUser(`${metaPrefix}${entry.uid}`, entry.token)
        }
      }
    } finally {
      await this.releaseQueueLock(lockKey, lockToken)
    }
  }

  private async avgTier(userIds: number[]): Promise<number> {
    let sum = 0
    for (const uid of userIds) {
      const u = await this.userRepo.findOne({ where: { id: uid } })
      sum += u?.rankTier ?? 1
    }
    return userIds.length ? Math.round(sum / userIds.length) : 1
  }
  private nextAiId(): number { return this.aiIdSeq-- }

  // ===== 对局生命周期 =====

  private async setupMatch(userIdA: number, userIdB: number, mode: MatchMode): Promise<void> {
    const gridEntity = await this.gridPoolService.acquire('standard')
    if (!gridEntity) throw new NotFoundException('暂无可用网格')
    const matchId = uuidv4()
    const sessionA = await this.gameService.createSessionFromGrid(gridEntity, userIdA, MATCH_DURATION, matchId)
    const sessionB = await this.gameService.createSessionFromGrid(gridEntity, userIdB, MATCH_DURATION, matchId)
    await this.matchRepo.save(this.matchRepo.create({ id: matchId, type: 'pvp_1v1', mode, gridSeed: sessionA.gridSeed, grid: gridEntity.grid, targetWords: gridEntity.targetWords, status: 'ongoing', winnerId: null, endedAt: null }))
    await this.redis.hset(`match_session:${sessionA.matchSessionId}`, { pvpType: 'pvp_1v1', matchMode: mode })
    await this.redis.hset(`match_session:${sessionB.matchSessionId}`, { pvpType: 'pvp_1v1', matchMode: mode })
    const room: MatchRoom = {
      matchId, type: 'pvp_1v1', mode, grid: gridEntity.grid, size: gridEntity.size, duration: MATCH_DURATION,
      players: new Map([[userIdA, { sid: sessionA.matchSessionId, clientConnected: true, isAi: false }], [userIdB, { sid: sessionB.matchSessionId, clientConnected: true, isAi: false }]]),
      status: 'countdown', remainingSec: MATCH_DURATION + COUNTDOWN_SEC, lastScores: new Map([[userIdA, 0], [userIdB, 0]]), aiTimers: new Map(), aiPools: new Map(), aiIndices: new Map(), aiCombo: new Map(),
    }
    this.rooms.set(matchId, room)
    this.playerMatch.set(userIdA, matchId); this.playerMatch.set(userIdB, matchId)
    this.logger.log(`Match ${matchId}: user ${userIdA} vs ${userIdB}`)
    const [userA, userB] = await Promise.all([this.userRepo.findOne({ where: { id: userIdA } }), this.userRepo.findOne({ where: { id: userIdB } })])
    this.sendMatchStart(room, userIdA, sessionA.matchSessionId, userB)
    this.sendMatchStart(room, userIdB, sessionB.matchSessionId, userA)
    setTimeout(() => {
      const r = this.rooms.get(matchId); if (!r || r.status !== 'countdown') return
      r.status = 'playing'; r.remainingSec = MATCH_DURATION; r.ticker = setInterval(() => void this.tick(matchId), 1000)
    }, COUNTDOWN_SEC * 1000)
  }

  private async setupMatchWithAi(userId: number, mode: MatchMode): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } })
    const tier = user?.rankTier ?? 1
    const aiLevel = this.aiService.levelForAvgTier(tier)
    const aiId = this.nextAiId()
    const gridEntity = await this.gridPoolService.acquire('standard')
    if (!gridEntity) throw new NotFoundException('暂无可用网格')
    const matchId = uuidv4()
    const sessionHuman = await this.gameService.createSessionFromGrid(gridEntity, userId, MATCH_DURATION, matchId)
    const sessionAi = await this.gameService.createSessionFromGrid(gridEntity, aiId, MATCH_DURATION, matchId)
    await this.redis.hset(`match_session:${sessionHuman.matchSessionId}`, { pvpType: 'pvp_1v1', matchMode: mode })
    await this.redis.hset(`match_session:${sessionAi.matchSessionId}`, { isAi: '1', aiLevel, pvpType: 'pvp_1v1', matchMode: mode })
    await this.matchRepo.save(this.matchRepo.create({ id: matchId, type: 'pvp_1v1', mode, gridSeed: sessionHuman.gridSeed, grid: gridEntity.grid, targetWords: gridEntity.targetWords, status: 'ongoing', winnerId: null, endedAt: null }))
    const potentialWithRarity = JSON.parse(await this.redis.hget(`match_session:${sessionHuman.matchSessionId}`, 'potentialWordsWithRarity') ?? '[]') as Array<{ word: string; rarity: string; length: number }>
    const pool = this.aiService.buildCandidatePool(potentialWithRarity, aiLevel)
    const room: MatchRoom = {
      matchId, type: 'pvp_1v1', mode, grid: gridEntity.grid, size: gridEntity.size, duration: MATCH_DURATION,
      players: new Map([[userId, { sid: sessionHuman.matchSessionId, clientConnected: true, isAi: false }], [aiId, { sid: sessionAi.matchSessionId, clientConnected: true, isAi: true, aiLevel }]]),
      status: 'countdown', remainingSec: MATCH_DURATION + COUNTDOWN_SEC, lastScores: new Map([[userId, 0], [aiId, 0]]), aiTimers: new Map(), aiPools: new Map([[aiId, pool]]), aiIndices: new Map([[aiId, 0]]), aiCombo: new Map([[aiId, 0]]),
    }
    this.rooms.set(matchId, room); this.playerMatch.set(userId, matchId)
    this.logger.log(`Match ${matchId}: user ${userId} vs AI ${aiId} ${aiLevel}`)
    this.sendMatchStart(room, userId, sessionHuman.matchSessionId, null, aiId, aiLevel)
    setTimeout(() => {
      const r = this.rooms.get(matchId); if (!r || r.status !== 'countdown') return
      r.status = 'playing'; r.remainingSec = MATCH_DURATION; r.ticker = setInterval(() => void this.tick(matchId), 1000)
      this.startAiDriving(r, aiId)
    }, COUNTDOWN_SEC * 1000)
  }

  private async setupMatch4p(userIds: number[], aiLevelMap?: Map<number, string>, mode: MatchMode = 'casual'): Promise<void> {
    const gridEntity = await this.gridPoolService.acquire('standard')
    if (!gridEntity) throw new NotFoundException('暂无可用网格')
    const matchId = uuidv4()
    const sessions: Array<{ userId: number; sid: string }> = []
    for (const uid of userIds) {
      const s = await this.gameService.createSessionFromGrid(gridEntity, uid, MATCH_DURATION, matchId)
      if (uid < 0) {
        const lvl = aiLevelMap?.get(uid) ?? 'L3'
        await this.redis.hset(`match_session:${s.matchSessionId}`, { isAi: '1', aiLevel: lvl, pvpType: 'pvp_4p', matchMode: mode })
      } else {
        await this.redis.hset(`match_session:${s.matchSessionId}`, { pvpType: 'pvp_4p', matchMode: mode })
      }
      sessions.push({ userId: uid, sid: s.matchSessionId })
    }
    await this.matchRepo.save(this.matchRepo.create({ id: matchId, type: 'pvp_4p', mode, gridSeed: gridEntity.id, grid: gridEntity.grid, targetWords: gridEntity.targetWords, status: 'ongoing', winnerId: null, endedAt: null }))
    const players = new Map<number, RoomPlayer>()
    const lastScores = new Map<number, number>()
    const aiPools = new Map<number, Array<{ word: string; rarity: string; length: number; score: number }>>()
    const aiIndices = new Map<number, number>()
    const aiCombo = new Map<number, number>()
    const samplePotential = JSON.parse(await this.redis.hget(`match_session:${sessions[0].sid}`, 'potentialWordsWithRarity') ?? '[]') as Array<{ word: string; rarity: string; length: number }>
    for (const { userId, sid } of sessions) {
      const isAi = userId < 0
      const lvl = isAi ? (aiLevelMap?.get(userId) ?? 'L3') : undefined
      players.set(userId, { sid, clientConnected: true, isAi, aiLevel: lvl })
      lastScores.set(userId, 0)
      if (isAi && lvl) {
        const pool = this.aiService.buildCandidatePool(samplePotential, lvl)
        aiPools.set(userId, pool); aiIndices.set(userId, 0); aiCombo.set(userId, 0)
      } else {
        // for human, ensure playerMatch
        this.playerMatch.set(userId, matchId)
      }
    }
    const room: MatchRoom = { matchId, type: 'pvp_4p', mode, grid: gridEntity.grid, size: gridEntity.size, duration: MATCH_DURATION, players, status: 'countdown', remainingSec: MATCH_DURATION + COUNTDOWN_SEC, lastScores, aiTimers: new Map(), aiPools, aiIndices, aiCombo }
    this.rooms.set(matchId, room)
    // if AI-only? not possible (at least 1 human)
    this.logger.log(`Match4p ${matchId}: ${userIds.join(',')}`)
    for (const { userId, sid } of sessions) {
      if (userId < 0) continue
      this.sendMatchStart4p(room, userId, sid)
    }
    setTimeout(() => {
      const r = this.rooms.get(matchId); if (!r || r.status !== 'countdown') return
      r.status = 'playing'; r.remainingSec = MATCH_DURATION; r.ticker = setInterval(() => void this.tick(matchId), 1000)
      for (const uid of userIds) if (uid < 0) this.startAiDriving(r, uid)
    }, COUNTDOWN_SEC * 1000)
  }

  private sendMatchStart(room: MatchRoom, myUserId: number, mySid: string, opponent: UserEntity | null, aiId?: number, aiLevel?: string): void {
    if (aiId !== undefined) {
      this.broadcastToUser(myUserId, 'match_start', { matchId: room.matchId, mode: room.mode, grid: room.grid, size: room.size, duration: room.duration, mySid, opponent: { nickname: `AI-${aiLevel}`, rankTier: 1 }, isAi: true, aiLevel })
      return
    }
    this.broadcastToUser(myUserId, 'match_start', { matchId: room.matchId, mode: room.mode, grid: room.grid, size: room.size, duration: room.duration, mySid, opponent: { nickname: opponent?.nickname ?? `玩家${opponent?.id ?? ''}`, rankTier: opponent?.rankTier ?? 1 } })
  }
  private sendMatchStart4p(room: MatchRoom, myUserId: number, mySid: string): void {
    const players: Array<{ userId: number; nickname: string; rankTier: number; isAi: boolean; aiLevel?: string }> = []
    for (const [uid, rp] of room.players) {
      if (uid < 0) players.push({ userId: uid, nickname: `AI-${rp.aiLevel}`, rankTier: 1, isAi: true, aiLevel: rp.aiLevel })
      else {
        // nickname async? use sync fallback; will enrich with DB later if needed
        players.push({ userId: uid, nickname: `玩家${uid}`, rankTier: 1, isAi: false })
      }
    }
    // enrich nicknames for humans asynchronously but send immediate
    this.broadcastToUser(myUserId, 'match_start_4p', { matchId: room.matchId, mode: room.mode, grid: room.grid, size: room.size, duration: room.duration, mySid, players })
    // async enrich
    void (async () => {
      for (const p of players) if (!p.isAi) {
        const u = await this.userRepo.findOne({ where: { id: p.userId } })
        if (u) { p.nickname = u.nickname ?? p.nickname; p.rankTier = u.rankTier ?? 1 }
      }
      this.broadcastToUser(myUserId, 'match_start_4p', { matchId: room.matchId, mode: room.mode, grid: room.grid, size: room.size, duration: room.duration, mySid, players })
    })()
  }

  private async tick(matchId: string): Promise<void> {
    const room = this.rooms.get(matchId)
    if (!room || room.status !== 'playing') return
    room.remainingSec--
    await this.broadcastScores(room, false)
    if (room.remainingSec <= 0) {
      try {
        if (room.type === 'pvp_4p') await this.finishMatch4p(matchId)
        else await this.finishMatch(matchId)
      } catch (error) {
        this.logger.error(`match ${matchId} settlement failed: ${(error as Error).message}`)
      }
    }
  }

  async broadcastScore(matchId: string): Promise<void> {
    const room = this.rooms.get(matchId)
    if (!room || room.status !== 'playing') return
    await this.broadcastScores(room, true)
  }

  private async broadcastScores(room: MatchRoom, withDelta: boolean): Promise<void> {
    const ids = [...room.players.keys()]
    const pipe = this.redis.pipeline()
    for (const uid of ids) {
      const sid = room.players.get(uid)!.sid
      pipe.hgetall(`match_session:${sid}`)
    }
    const results = await pipe.exec()
    if (!results) return
    const scores = new Map<number, number>()
    const combos = new Map<number, number>()
    for (let i = 0; i < ids.length; i++) {
      const res = results[i]
      const fallback = room.lastScores.get(ids[i]) ?? 0
      const score = res && !res[0] ? parseInt((res[1] as Record<string, string>).score || '0', 10) : fallback
      const combo = res && !res[0] ? parseInt((res[1] as Record<string, string>).combo || '0', 10) : 0
      scores.set(ids[i], score); combos.set(ids[i], combo)
    }
    // compute deltas
    const deltas = new Map<number, number>()
    for (const uid of ids) {
      const prev = room.lastScores.get(uid) ?? 0
      deltas.set(uid, (scores.get(uid) ?? 0) - prev)
      room.lastScores.set(uid, scores.get(uid) ?? 0)
    }

    if (room.type === 'pvp_4p') {
      // broadcast to each human
      for (const uid of ids) {
        if (uid < 0) continue
        const myScore = scores.get(uid) ?? 0
        const myCombo = combos.get(uid) ?? 0
        const players = ids.map(id => ({ userId: id, score: scores.get(id) ?? 0, combo: combos.get(id) ?? 0, isAi: id < 0 }))
        // rank by score desc
        const sorted = [...players].sort((a, b) => b.score - a.score)
        const ranks = sorted.map((p, idx) => ({ ...p, rank: idx + 1 }))
        this.broadcastToUser(uid, 'match_tick_4p', { remainingSec: room.remainingSec, myScore, myCombo, players, ranks })
      }
      if (withDelta) {
        // opponent delta for 4p: send per scorer to others
        for (const uid of ids) {
          const d = deltas.get(uid) ?? 0
          if (d > 0) {
            for (const other of ids) if (other !== uid && other > 0) {
              this.broadcastToUser(other, 'match_opponent_score_4p', { userId: uid, delta: d, total: scores.get(uid) ?? 0 })
            }
          }
        }
      }
    } else {
      const [aId, bId] = ids
      const scoreA = scores.get(aId) ?? 0, scoreB = scores.get(bId) ?? 0
      const comboA = combos.get(aId) ?? 0, comboB = combos.get(bId) ?? 0
      const deltaA = deltas.get(aId) ?? 0, deltaB = deltas.get(bId) ?? 0
      this.broadcastToUser(aId, 'match_tick', { remainingSec: room.remainingSec, myScore: scoreA, opponentScore: scoreB, myCombo: comboA, opponentCombo: comboB })
      this.broadcastToUser(bId, 'match_tick', { remainingSec: room.remainingSec, myScore: scoreB, opponentScore: scoreA, myCombo: comboB, opponentCombo: comboA })
      if (withDelta) {
        if (deltaB > 0) this.broadcastToUser(aId, 'match_opponent_score', { delta: deltaB, total: scoreB })
        if (deltaA > 0) this.broadcastToUser(bId, 'match_opponent_score', { delta: deltaA, total: scoreA })
      }
    }
  }

  // ===== 结算 =====

  private async finishMatch(matchId: string, forfeitUserId?: number, forfeitReason?: 'abandon' | 'disconnect'): Promise<void> {
    const room = this.rooms.get(matchId)
    if (!room || room.status === 'finished') return
    room.status = 'finished'
    if (room.ticker) clearInterval(room.ticker)
    room.ticker = undefined
    for (const t of room.aiTimers.values()) clearTimeout(t)
    room.aiTimers.clear()
    const ids = [...room.players.keys()]
    const [aId, bId] = ids
    const pa = room.players.get(aId)!, pb = room.players.get(bId)!
    let statsA: PlayerStats
    let statsB: PlayerStats
    try {
      const settled = await Promise.all([
        this.settlePlayerWithRetry(pa.sid, aId),
        this.settlePlayerWithRetry(pb.sid, bId),
      ])
      statsA = settled[0]
      statsB = settled[1]
    } catch (error) {
      await this.handleSettlementFailure(matchId, room, ids, error)
      return
    }
    let effectiveWinner: number
    let winnerUserId: number | null
    try {
      const winner = decideWinner(statsA, statsB)
      effectiveWinner = forfeitUserId === undefined ? winner : forfeitUserId === aId ? 2 : forfeitUserId === bId ? 1 : winner
      winnerUserId = effectiveWinner === 0 ? null : effectiveWinner === 1 ? aId : bId
    const winnerForDb = winnerUserId !== null && winnerUserId < 0 ? null : winnerUserId
    const endedAt = new Date()
    const statusUpdate = await this.matchRepo.update(
      { id: matchId, status: 'ongoing' },
      { status: 'finished', winnerId: winnerForDb as unknown as number | null, endedAt },
    )
    if (statusUpdate.affected !== 1) {
      this.logger.warn(`Match ${matchId} already finalized by another worker`)
      return
    }
    const rankA = effectiveWinner === 2 ? 2 : 1
    const rankB = effectiveWinner === 1 ? 2 : 1
    const isAiA = aId < 0, isAiB = bId < 0
    const aiLevelA = pa.aiLevel ?? null, aiLevelB = pb.aiLevel ?? null
    await this.matchPlayerRepo.upsert([
      { matchId, userId: aId, score: statsA.score, rareCount: statsA.rareCount, maxCombo: statsA.maxCombo, rank: rankA, sid: pa.sid, isAi: isAiA, aiLevel: aiLevelA },
      { matchId, userId: bId, score: statsB.score, rareCount: statsB.rareCount, maxCombo: statsB.maxCombo, rank: rankB, sid: pb.sid, isAi: isAiB, aiLevel: aiLevelB },
    ], ['matchId', 'sid'])
    // 只有 ranked 模式改变段位；casual/AI 兜底不影响排位分。
    if (room.mode === 'ranked') {
      try {
        const oppTierA = isAiB ? 1 : (await this.userRepo.findOne({ where: { id: bId } }))?.rankTier ?? 1
        const oppTierB = isAiA ? 1 : (await this.userRepo.findOne({ where: { id: aId } }))?.rankTier ?? 1
        if (effectiveWinner === 0) {
          await this.rankService.updateRankAfterMatch(aId, oppTierA, 'draw', statsA.score)
          await this.rankService.updateRankAfterMatch(bId, oppTierB, 'draw', statsB.score)
        } else if (effectiveWinner === 1) {
          await this.rankService.updateRankAfterMatch(aId, oppTierA, 'win', statsA.score)
          await this.rankService.updateRankAfterMatch(bId, oppTierB, 'lose', statsB.score)
        } else {
          await this.rankService.updateRankAfterMatch(aId, oppTierA, 'lose', statsA.score)
          await this.rankService.updateRankAfterMatch(bId, oppTierB, 'win', statsB.score)
        }
        if (effectiveWinner === 0) {
          if (aId > 0) await this.economyService.addCoins(aId, 10)
          if (bId > 0) await this.economyService.addCoins(bId, 10)
        } else {
          const winnerId = effectiveWinner === 1 ? aId : bId
          if (winnerId > 0) await this.economyService.addCoins(winnerId, 50)
        }
      } catch (error) {
        this.logger.warn(`ranked settlement rewards failed for ${matchId}: ${(error as Error).message}`)
      }
    }
    } catch (error) {
      await this.handleSettlementFailure(matchId, room, ids, error)
      return
    }
    const endA = { matchId, winnerUserId, won: effectiveWinner === 1, forfeit: forfeitUserId !== undefined, forfeitReason: forfeitUserId !== undefined ? forfeitReason : null, opponentForfeit: forfeitUserId === bId, my: statsA, opponent: statsB }
    const endB = { matchId, winnerUserId, won: effectiveWinner === 2, forfeit: forfeitUserId !== undefined, forfeitReason: forfeitUserId !== undefined ? forfeitReason : null, opponentForfeit: forfeitUserId === aId, my: statsB, opponent: statsA }
    room.lastMatchEnd = endA
    this.broadcastToUser(aId, 'match_end', endA)
    this.broadcastToUser(bId, 'match_end', endB)
    for (const uid of ids) if (uid > 0) this.playerMatch.delete(uid)
    this.rooms.delete(matchId)
    this.logger.log(`Match ${matchId} finished: A=${statsA.score} B=${statsB.score}`)
  }

  private async finishMatch4p(matchId: string, forfeitUserId?: number, forfeitReason?: 'abandon' | 'disconnect'): Promise<void> {
    const room = this.rooms.get(matchId)
    if (!room || room.status === 'finished') return
    room.status = 'finished'
    if (room.ticker) clearInterval(room.ticker)
    room.ticker = undefined
    for (const t of room.aiTimers.values()) clearTimeout(t)
    room.aiTimers.clear()
    const ids = [...room.players.keys()]
    const statsMap = new Map<number, PlayerStats>()
    try {
      await Promise.all(ids.map(async uid => {
        const sid = room.players.get(uid)!.sid
        const s = await this.settlePlayerWithRetry(sid, uid)
        statsMap.set(uid, s)
      }))
    } catch (error) {
      await this.handleSettlementFailure(matchId, room, ids, error)
      return
    }
    // ranking: sort by score -> rare -> maxCombo, forfeit user forced last
    let sorted: number[]
    let ranks: Map<number, number>
    let winnerId: number
    try {
      sorted = [...ids].sort((a, b) => {
        if (forfeitUserId !== undefined) {
          if (a === forfeitUserId) return 1
          if (b === forfeitUserId) return -1
        }
        const sa = statsMap.get(a)!, sb = statsMap.get(b)!
        if (sa.score !== sb.score) return sb.score - sa.score
        if (sa.rareCount !== sb.rareCount) return sb.rareCount - sa.rareCount
        return sb.maxCombo - sa.maxCombo
      })
      ranks = new Map<number, number>()
      let previousKey: string | null = null
      let previousRank = 0
      sorted.forEach((uid, index) => {
        const stats = statsMap.get(uid)!
        const key = `${stats.score}:${stats.rareCount}:${stats.maxCombo}`
        const rank = key === previousKey ? previousRank : index + 1
        ranks.set(uid, rank)
        previousKey = key
        previousRank = rank
      })
      winnerId = sorted[0]
    const winnerForDb = winnerId < 0 ? null : winnerId
    const statusUpdate = await this.matchRepo.update(
      { id: matchId, status: 'ongoing' },
      { status: 'finished', winnerId: winnerForDb as unknown as number | null, endedAt: new Date() },
    )
    if (statusUpdate.affected !== 1) {
      this.logger.warn(`Match4p ${matchId} already finalized by another worker`)
      return
    }
    const rows: MatchPlayerEntity[] = []
    for (const uid of ids) {
      const rp = room.players.get(uid)!
      const st = statsMap.get(uid)!
      rows.push(this.matchPlayerRepo.create({ matchId, userId: uid, score: st.score, rareCount: st.rareCount, maxCombo: st.maxCombo, rank: ranks.get(uid)!, sid: rp.sid, isAi: uid < 0, aiLevel: rp.aiLevel ?? null } as Partial<MatchPlayerEntity> as MatchPlayerEntity))
    }
    await this.matchPlayerRepo.upsert(rows, ['matchId', 'sid'])
    // 只有 ranked 模式改变段位；4p 以其余真人平均段位作为对手基准。
    if (room.mode === 'ranked') {
      for (const uid of ids) {
        if (uid <= 0) continue
        const opponentIds = ids.filter((other) => other > 0 && other !== uid)
        let tierSum = 0
        for (const opponentId of opponentIds) {
          tierSum += (await this.userRepo.findOne({ where: { id: opponentId } }))?.rankTier ?? 1
        }
        const oppAvg = opponentIds.length > 0 ? Math.round(tierSum / opponentIds.length) : 1
        const r = ranks.get(uid)!
        try {
          if (r === 1) await this.rankService.updateRankAfterMatch(uid, oppAvg, 'win', statsMap.get(uid)?.score ?? 0)
          else await this.rankService.updateRankAfterMatch(uid, oppAvg, 'lose', statsMap.get(uid)?.score ?? 0)
        } catch (error) {
          this.logger.warn(`4p rank update failed for ${uid}: ${(error as Error).message}`)
        }
      }
    }
    for (const uid of ids) {
      if (uid <= 0) continue
      const r = ranks.get(uid)!
      try {
        await this.achievementService.check(uid, 'match_4p', { rank: r })
        await this.economyService.addCoins(uid, r === 1 ? 100 : 20)
      } catch (error) {
        this.logger.warn(`4p reward failed for ${uid}: ${(error as Error).message}`)
      }
    }
    } catch (error) {
      await this.handleSettlementFailure(matchId, room, ids, error)
      return
    }
    // broadcast to each human
    for (const uid of ids) if (uid > 0) {
      const myStats = statsMap.get(uid)!
      const myRank = ranks.get(uid)!
      const allRanks = sorted.map(id => ({ userId: id, score: statsMap.get(id)!.score, rareCount: statsMap.get(id)!.rareCount, maxCombo: statsMap.get(id)!.maxCombo, rank: ranks.get(id)!, isAi: id < 0, aiLevel: room.players.get(id)!.aiLevel ?? null }))
      this.broadcastToUser(uid, 'match_end_4p', { matchId, myRank, won: myRank === 1, forfeit: forfeitUserId === uid, forfeitReason: forfeitUserId === uid ? forfeitReason : null, my: myStats, ranks: allRanks, winnerUserId: winnerId })
    }
    for (const uid of ids) if (uid > 0) this.playerMatch.delete(uid)
    this.rooms.delete(matchId)
    this.logger.log(`Match4p ${matchId} finished ranks ${sorted.join(',')}`)
  }

  private async handleSettlementFailure(
    matchId: string,
    room: MatchRoom,
    userIds: number[],
    error: unknown,
  ): Promise<void> {
    this.logger.error(
      `Match ${matchId} settlement failed: ${(error as Error).message}`,
    )
    try {
      await this.matchRepo.update(
        { id: matchId },
        { status: 'error', endedAt: new Date() },
      )
    } catch (updateError) {
      this.logger.error(
        `Match ${matchId} failure status update failed: ${(updateError as Error).message}`,
      )
    }
    for (const userId of userIds) {
      this.broadcastToUser(userId, 'match_error', {
        matchId,
        message: '对局结算失败，请返回大厅重试',
      })
      if (userId > 0) this.playerMatch.delete(userId)
    }
    if (room.ticker) clearInterval(room.ticker)
    for (const timer of room.aiTimers.values()) clearTimeout(timer)
    room.aiTimers.clear()
    for (const player of room.players.values()) {
      if (player.disconnectTimer) clearTimeout(player.disconnectTimer)
    }
    this.rooms.delete(matchId)
  }

  private async settlePlayerWithRetry(
    sid: string,
    userId: number,
  ): Promise<PlayerStats> {
    let lastError: unknown = new Error('对局结算失败')
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.settlePlayer(sid, userId)
      } catch (error) {
        lastError = error
        this.logger.warn(
          `settle player ${sid} failed (attempt ${attempt + 1}/3): ${(error as Error).message}`,
        )
        if (attempt < 2) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('对局结算失败')
  }

  private async settlePlayer(sid: string, userId: number): Promise<PlayerStats> {
    const isAi = await this.redis.hget(`match_session:${sid}`, 'isAi')
    if (isAi === '1') {
      const sess = await this.redis.hgetall(`match_session:${sid}`)
      const score = parseInt(sess.score || '0', 10)
      const maxCombo = parseInt(sess.maxCombo || '0', 10)
      const foundWords = await this.redis.smembers(`match_session:${sid}:found`)
      const rarityEntries = sess.potentialWordsWithRarity
        ? (JSON.parse(sess.potentialWordsWithRarity) as Array<{ word: string; rarity: string }>)
        : []
      const rarityMap = new Map(rarityEntries.map((entry) => [entry.word, entry.rarity]))
      const rareCount = foundWords.filter((word) => {
        const rarity = rarityMap.get(word)
        return rarity === 'idiom' || rarity === 'rare'
      }).length
      return { score, rareCount, maxCombo, foundWords: [] }
    }
    const res = await this.gameService.endGame(userId, sid)
    const rareCount = res.foundWords.filter(
      (word) => word.rarity === 'idiom' || word.rarity === 'rare',
    ).length
    return {
      score: res.score,
      rareCount,
      maxCombo: res.maxCombo,
      foundWords: res.foundWords,
    }
  }

  // ===== 断线重连 =====

  handleDisconnect(userId: number): void {
    const matchId = this.playerMatch.get(userId)
    if (!matchId) return
    const room = this.rooms.get(matchId)
    if (!room || room.status === 'finished') return
    const player = room.players.get(userId)
    if (!player || player.isAi) return
    player.clientConnected = false
    player.disconnectTimer = setTimeout(() => {
      const r = this.rooms.get(matchId)
      const p = r?.players.get(userId)
      if (r && p && !p.clientConnected && r.status !== 'finished') {
        this.logger.warn(`Match ${matchId}: user ${userId} disconnected > ${DISCONNECT_GRACE_MS}ms, forfeit`)
        if (r.type === 'pvp_4p') {
          void this.finishMatch4p(matchId, userId, 'disconnect').catch((error: unknown) => {
            this.logger.error(`match ${matchId} settlement failed: ${(error as Error).message}`)
          })
        } else {
          void this.finishMatch(matchId, userId, 'disconnect').catch((error: unknown) => {
            this.logger.error(`match ${matchId} settlement failed: ${(error as Error).message}`)
          })
        }
      }
    }, DISCONNECT_GRACE_MS)
  }

  async handleJoin(userId: number, matchId: string): Promise<void> {
    const room = this.rooms.get(matchId)
    if (!room) return
    const player = room.players.get(userId)
    if (!player) return
    player.clientConnected = true
    if (player.disconnectTimer) { clearTimeout(player.disconnectTimer); player.disconnectTimer = undefined }
    if (room.status === 'finished' && room.lastMatchEnd) {
      this.broadcastToUser(userId, 'match_end', room.lastMatchEnd as unknown as Record<string, unknown>)
      return
    }
    if (room.type === 'pvp_4p') {
      const myScore = parseInt((await this.redis.hget(`match_session:${player.sid}`, 'score')) || '0', 10)
      this.broadcastToUser(userId, 'match_restore_4p', { matchId, remainingSec: room.remainingSec, myScore, grid: room.grid, size: room.size, mySid: player.sid })
      return
    }
    const opponentId = [...room.players.keys()].find(id => id !== userId)!
    const isAiOpp = opponentId < 0
    let opponent: UserEntity | null = null
    if (!isAiOpp) opponent = await this.userRepo.findOne({ where: { id: opponentId } })
    const session = await this.redis.hgetall(`match_session:${player.sid}`)
    const myScore = parseInt(session.score || '0', 10)
    const oppSid = room.players.get(opponentId)!.sid
    const oppSession = await this.redis.hgetall(`match_session:${oppSid}`)
    const oppScore = parseInt(oppSession.score || '0', 10)
    if (isAiOpp) {
      this.broadcastToUser(userId, 'match_restore', { matchId, remainingSec: room.remainingSec, myScore, opponentScore: oppScore, grid: room.grid, size: room.size, mySid: player.sid, opponent: { nickname: `AI-${room.players.get(opponentId)!.aiLevel}`, rankTier: 1 } })
    } else {
      this.broadcastToUser(userId, 'match_restore', { matchId, remainingSec: room.remainingSec, myScore, opponentScore: oppScore, grid: room.grid, size: room.size, mySid: player.sid, opponent: { nickname: opponent?.nickname ?? `玩家${opponentId}`, rankTier: opponent?.rankTier ?? 1 } })
    }
  }

  private leaveMatch(userId: number, matchId: string): void {
    this.playerMatch.delete(userId)
    const room = this.rooms.get(matchId)
    if (room) room.players.delete(userId)
  }

  // ===== AI 驱动 =====

  private startAiDriving(room: MatchRoom, aiId: number): void {
    const pool = room.aiPools.get(aiId)
    if (!pool || pool.length === 0) return
    const aiLevel = room.players.get(aiId)?.aiLevel ?? 'L3'
    const nextIndex = room.aiIndices.get(aiId) ?? 0
    const entry = pool[nextIndex % pool.length]
    room.aiIndices.set(aiId, (nextIndex + 1) % pool.length)
    const elapsedSec = 180 - room.remainingSec
    if (this.aiService.shouldMiss(aiLevel, entry.rarity, elapsedSec)) {
      const t = setTimeout(() => this.startAiDriving(room, aiId), this.aiService.randomInterval(aiLevel))
      room.aiTimers.set(aiId, t)
      return
    }
    const delay = this.aiService.randomInterval(aiLevel)
    const t = setTimeout(async () => {
      if (room.status !== 'playing') return
      const sid = room.players.get(aiId)!.sid
      const sessionKey = `match_session:${sid}`
      const foundKey = `${sessionKey}:found`
      if (await this.redis.sismember(foundKey, entry.word)) {
        this.startAiDriving(room, aiId)
        return
      }
      let raw: unknown
      try {
        raw = await this.redis.eval(
          SUBMIT_WORD_SCRIPT,
          3,
          sessionKey,
          foundKey,
          `${sessionKey}:end-lock`,
          entry.word,
          entry.score.toString(),
          Date.now().toString(),
          COMBO_WINDOW_MS.toString(),
          MAX_COMBO.toString(),
          '0',
          '0',
          SESSION_TTL.toString(),
        )
      } catch (error) {
        this.logger.warn(`AI submit failed for ${sid}: ${(error as Error).message}`)
        this.startAiDriving(room, aiId)
        return
      }
      const values = Array.isArray(raw) ? raw : []
      const status = String(values[0] ?? '')
      if (status === 'duplicate') {
        this.startAiDriving(room, aiId)
        return
      }
      if (status !== 'ok') {
        if (status === 'settling' || status === 'settled' || status === 'expired' || status === 'missing') {
          return
        }
        this.logger.warn(`AI submit failed for ${sid}: ${status || 'empty response'}`)
        this.startAiDriving(room, aiId)
        return
      }
      try {
        await this.broadcastScores(room, true)
      } catch (error) {
        this.logger.warn(`AI score broadcast failed for ${sid}: ${(error as Error).message}`)
      }
      this.startAiDriving(room, aiId)
    }, delay)
    room.aiTimers.set(aiId, t)
  }
}
