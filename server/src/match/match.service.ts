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
import { calcScore } from '../game/check'
import type { Rarity } from '../grid-gen/types'

const QUEUE_TIMEOUT_MS = 30000
const DISCONNECT_GRACE_MS = 30000
const MATCH_DURATION = 180
const COUNTDOWN_SEC = 3
const MATCH_TIERS = [1, 2, 3, 4, 5, 6, 7]

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
  ) {}

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
      await this.redis.rpush(`match_queue_4p:${tier}`, userId.toString())
      await this.redis.hset(`match_queue_4p_meta:${userId}`, { tier: tier.toString(), enqueuedAt: Date.now().toString(), mode: opts?.mode ?? 'casual' })
      await this.tryPairQueue4p(tier)
    } else {
      await this.redis.rpush(`match_queue:${tier}`, userId.toString())
      await this.redis.hset(`match_queue_meta:${userId}`, { tier: tier.toString(), enqueuedAt: Date.now().toString(), mode: opts?.mode ?? 'casual' })
      await this.tryPairQueue(tier)
    }
    return { status: 'queued' }
  }

  async queueStatus(userId: number, opts?: { size?: number }): Promise<{
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
      await this.redis.lrem(`match_queue:${meta.tier}`, 0, userId.toString())
      await this.redis.del(`match_queue_meta:${userId}`)
      return { cancelled: true }
    }
    return { cancelled: false }
  }
  async cancelQueue4p(userId: number): Promise<{ cancelled: boolean }> {
    const meta = await this.redis.hgetall(`match_queue_4p_meta:${userId}`)
    if (meta.tier) {
      await this.redis.lrem(`match_queue_4p:${meta.tier}`, 0, userId.toString())
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
    for (const tier of MATCH_TIERS) {
      await this.tryPairQueue(tier)
      await this.tryPairQueue4p(tier)
    }
  }

  private async tryPairQueue(tier: number): Promise<void> {
    const key = `match_queue:${tier}`
    const ids = await this.redis.lrange(key, 0, -1)
    if (ids.length >= 2) {
      const picked: number[] = []
      for (const idStr of ids) {
        if (picked.length >= 2) break
        const uid = parseInt(idStr, 10)
        const meta = await this.redis.hgetall(`match_queue_meta:${uid}`)
        // if missing meta, treat as stale
        if (!meta.tier) { await this.redis.lrem(key, 0, idStr); continue }
        picked.push(uid)
        await this.redis.lrem(key, 0, idStr)
      }
      if (picked.length < 2) {
        for (const uid of picked) {
          const meta = await this.redis.hgetall(`match_queue_meta:${uid}`)
          if (meta.tier) await this.redis.rpush(key, uid.toString())
        }
        return
      }
      const [a, b] = picked
      await this.redis.del(`match_queue_meta:${a}`, `match_queue_meta:${b}`)
      try { await this.setupMatch(a, b) } catch (e) {
        this.logger.warn(`setupMatch failed: ${(e as Error).message}`)
        await this.redis.rpush(key, a.toString(), b.toString())
        await this.redis.hset(`match_queue_meta:${a}`, { tier: tier.toString(), enqueuedAt: Date.now().toString() })
        await this.redis.hset(`match_queue_meta:${b}`, { tier: tier.toString(), enqueuedAt: Date.now().toString() })
      }
      return
    }
    if (ids.length === 1) {
      const uid = parseInt(ids[0], 10)
      const meta = await this.redis.hgetall(`match_queue_meta:${uid}`)
      if (!meta.tier) { await this.redis.lrem(key, 0, ids[0]); return }
      const elapsed = Date.now() - parseInt(meta.enqueuedAt || '0', 10)
      if (elapsed > QUEUE_TIMEOUT_MS) {
        await this.redis.lrem(key, 0, ids[0])
        await this.redis.del(`match_queue_meta:${uid}`)
        try { await this.setupMatchWithAi(uid) } catch (e) {
          this.logger.warn(`setupMatchWithAi failed: ${(e as Error).message}`)
          await this.redis.rpush(key, uid.toString())
          await this.redis.hset(`match_queue_meta:${uid}`, { tier: tier.toString(), enqueuedAt: Date.now().toString() })
        }
      }
    }
  }

  private async tryPairQueue4p(tier: number): Promise<void> {
    const key = `match_queue_4p:${tier}`
    const ids = await this.redis.lrange(key, 0, -1)
    if (ids.length === 0) return
    if (ids.length >= 4) {
      const picked: number[] = []
      for (const idStr of ids) {
        if (picked.length >= 4) break
        const uid = parseInt(idStr, 10)
        const meta = await this.redis.hgetall(`match_queue_4p_meta:${uid}`)
        if (!meta.tier) { await this.redis.lrem(key, 0, idStr); continue }
        picked.push(uid); await this.redis.lrem(key, 0, idStr)
      }
      if (picked.length < 4) { for (const uid of picked) await this.redis.rpush(key, uid.toString()); return }
      for (const uid of picked) await this.redis.del(`match_queue_4p_meta:${uid}`)
      try { await this.setupMatch4p(picked) } catch (e) {
        this.logger.warn(`setupMatch4p failed: ${(e as Error).message}`)
        for (const uid of picked) { await this.redis.rpush(key, uid.toString()); await this.redis.hset(`match_queue_4p_meta:${uid}`, { tier: tier.toString(), enqueuedAt: Date.now().toString() }) }
      }
      return
    }
    // 1-3 waiting and timeout -> fill AI to 4
    const firstMeta = await this.redis.hgetall(`match_queue_4p_meta:${parseInt(ids[0], 10)}`)
    const elapsed = Date.now() - parseInt(firstMeta.enqueuedAt || '0', 10)
    if (elapsed > QUEUE_TIMEOUT_MS) {
      const picked: number[] = []
      for (const idStr of ids) {
        const uid = parseInt(idStr, 10)
        const meta = await this.redis.hgetall(`match_queue_4p_meta:${uid}`)
        if (!meta.tier) { await this.redis.lrem(key, 0, idStr); continue }
        picked.push(uid); await this.redis.lrem(key, 0, idStr)
      }
      for (const uid of picked) await this.redis.del(`match_queue_4p_meta:${uid}`)
      if (picked.length === 0) return
      // fill AI to 4
      const avgTier = await this.avgTier(picked)
      const aiLevel = this.aiService.levelForAvgTier(avgTier)
      const needAi = 4 - picked.length
      const aiIds: number[] = []
      for (let i = 0; i < needAi; i++) aiIds.push(this.nextAiId())
      try { await this.setupMatch4p([...picked, ...aiIds], new Map(aiIds.map(id => [id, aiLevel]))) } catch (e) {
        this.logger.warn(`setupMatch4p AI fill failed: ${(e as Error).message}`)
        for (const uid of picked) { await this.redis.rpush(key, uid.toString()); await this.redis.hset(`match_queue_4p_meta:${uid}`, { tier: tier.toString(), enqueuedAt: Date.now().toString() }) }
      }
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

  private async setupMatch(userIdA: number, userIdB: number): Promise<void> {
    const gridEntity = await this.gridPoolService.acquire('standard')
    if (!gridEntity) throw new NotFoundException('暂无可用网格')
    const matchId = uuidv4()
    const sessionA = await this.gameService.createSessionFromGrid(gridEntity, userIdA, MATCH_DURATION, matchId)
    const sessionB = await this.gameService.createSessionFromGrid(gridEntity, userIdB, MATCH_DURATION, matchId)
    await this.matchRepo.save(this.matchRepo.create({ id: matchId, type: 'pvp_1v1', gridSeed: sessionA.gridSeed, grid: gridEntity.grid, targetWords: gridEntity.targetWords, status: 'ongoing', winnerId: null, endedAt: null }))
    const room: MatchRoom = {
      matchId, type: 'pvp_1v1', grid: gridEntity.grid, size: gridEntity.size, duration: MATCH_DURATION,
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

  private async setupMatchWithAi(userId: number): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } })
    const tier = user?.rankTier ?? 1
    const aiLevel = this.aiService.levelForAvgTier(tier)
    const aiId = this.nextAiId()
    const gridEntity = await this.gridPoolService.acquire('standard')
    if (!gridEntity) throw new NotFoundException('暂无可用网格')
    const matchId = uuidv4()
    const sessionHuman = await this.gameService.createSessionFromGrid(gridEntity, userId, MATCH_DURATION, matchId)
    const sessionAi = await this.gameService.createSessionFromGrid(gridEntity, aiId, MATCH_DURATION, matchId)
    await this.redis.hset(`match_session:${sessionAi.matchSessionId}`, { isAi: '1', aiLevel })
    await this.matchRepo.save(this.matchRepo.create({ id: matchId, type: 'pvp_1v1', gridSeed: sessionHuman.gridSeed, grid: gridEntity.grid, targetWords: gridEntity.targetWords, status: 'ongoing', winnerId: null, endedAt: null }))
    const potentialWithRarity = JSON.parse(await this.redis.hget(`match_session:${sessionHuman.matchSessionId}`, 'potentialWordsWithRarity') ?? '[]') as Array<{ word: string; rarity: string; length: number }>
    const pool = this.aiService.buildCandidatePool(potentialWithRarity, aiLevel)
    const room: MatchRoom = {
      matchId, type: 'pvp_1v1', grid: gridEntity.grid, size: gridEntity.size, duration: MATCH_DURATION,
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

  private async setupMatch4p(userIds: number[], aiLevelMap?: Map<number, string>): Promise<void> {
    const gridEntity = await this.gridPoolService.acquire('standard')
    if (!gridEntity) throw new NotFoundException('暂无可用网格')
    const matchId = uuidv4()
    const sessions: Array<{ userId: number; sid: string }> = []
    for (const uid of userIds) {
      const s = await this.gameService.createSessionFromGrid(gridEntity, uid, MATCH_DURATION, matchId)
      if (uid < 0) {
        const lvl = aiLevelMap?.get(uid) ?? 'L3'
        await this.redis.hset(`match_session:${s.matchSessionId}`, { isAi: '1', aiLevel: lvl })
      }
      sessions.push({ userId: uid, sid: s.matchSessionId })
    }
    await this.matchRepo.save(this.matchRepo.create({ id: matchId, type: 'pvp_4p', gridSeed: gridEntity.id, grid: gridEntity.grid, targetWords: gridEntity.targetWords, status: 'ongoing', winnerId: null, endedAt: null }))
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
    const room: MatchRoom = { matchId, type: 'pvp_4p', grid: gridEntity.grid, size: gridEntity.size, duration: MATCH_DURATION, players, status: 'countdown', remainingSec: MATCH_DURATION + COUNTDOWN_SEC, lastScores, aiTimers: new Map(), aiPools, aiIndices, aiCombo }
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
      this.broadcastToUser(myUserId, 'match_start', { matchId: room.matchId, grid: room.grid, size: room.size, duration: room.duration, mySid, opponent: { nickname: `AI-${aiLevel}`, rankTier: 1 }, isAi: true, aiLevel })
      return
    }
    this.broadcastToUser(myUserId, 'match_start', { matchId: room.matchId, grid: room.grid, size: room.size, duration: room.duration, mySid, opponent: { nickname: opponent?.nickname ?? `玩家${opponent?.id ?? ''}`, rankTier: opponent?.rankTier ?? 1 } })
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
    this.broadcastToUser(myUserId, 'match_start_4p', { matchId: room.matchId, grid: room.grid, size: room.size, duration: room.duration, mySid, players })
    // async enrich
    void (async () => {
      for (const p of players) if (!p.isAi) {
        const u = await this.userRepo.findOne({ where: { id: p.userId } })
        if (u) { p.nickname = u.nickname ?? p.nickname; p.rankTier = u.rankTier ?? 1 }
      }
      this.broadcastToUser(myUserId, 'match_start_4p', { matchId: room.matchId, grid: room.grid, size: room.size, duration: room.duration, mySid, players })
    })()
  }

  private async tick(matchId: string): Promise<void> {
    const room = this.rooms.get(matchId)
    if (!room || room.status !== 'playing') return
    room.remainingSec--
    await this.broadcastScores(room, false)
    if (room.remainingSec <= 0) {
      if (room.type === 'pvp_4p') await this.finishMatch4p(matchId)
      else await this.finishMatch(matchId)
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
    const [statsA, statsB] = await Promise.all([this.settlePlayer(pa.sid), this.settlePlayer(pb.sid)])
    const winner = decideWinner(statsA, statsB)
    const effectiveWinner = forfeitUserId === undefined ? winner : forfeitUserId === aId ? 2 : forfeitUserId === bId ? 1 : winner
    const winnerUserId = effectiveWinner === 0 ? null : effectiveWinner === 1 ? aId : bId
    const winnerForDb = winnerUserId !== null && winnerUserId < 0 ? null : winnerUserId
    const endedAt = new Date()
    await this.matchRepo.update({ id: matchId }, { status: 'finished', winnerId: winnerForDb as unknown as number | null, endedAt })
    const rankA = effectiveWinner === 2 ? 2 : 1
    const rankB = effectiveWinner === 1 ? 2 : 1
    const isAiA = aId < 0, isAiB = bId < 0
    const aiLevelA = pa.aiLevel ?? null, aiLevelB = pb.aiLevel ?? null
    await this.matchPlayerRepo.save([
      this.matchPlayerRepo.create({ matchId, userId: aId, score: statsA.score, rareCount: statsA.rareCount, maxCombo: statsA.maxCombo, rank: rankA, sid: pa.sid, isAi: isAiA, aiLevel: aiLevelA } as Partial<MatchPlayerEntity> as MatchPlayerEntity),
      this.matchPlayerRepo.create({ matchId, userId: bId, score: statsB.score, rareCount: statsB.rareCount, maxCombo: statsB.maxCombo, rank: rankB, sid: pb.sid, isAi: isAiB, aiLevel: aiLevelB } as Partial<MatchPlayerEntity> as MatchPlayerEntity),
    ])
    // rank score update
    const oppTierA = isAiB ? 1 : (await this.userRepo.findOne({ where: { id: bId } }))?.rankTier ?? 1
    const oppTierB = isAiA ? 1 : (await this.userRepo.findOne({ where: { id: aId } }))?.rankTier ?? 1
    if (effectiveWinner === 0) {
      await this.rankService.updateRankAfterMatch(aId, oppTierA, 'draw')
      await this.rankService.updateRankAfterMatch(bId, oppTierB, 'draw')
    } else if (effectiveWinner === 1) {
      await this.rankService.updateRankAfterMatch(aId, oppTierA, 'win')
      await this.rankService.updateRankAfterMatch(bId, oppTierB, 'lose')
    } else {
      await this.rankService.updateRankAfterMatch(aId, oppTierA, 'lose')
      await this.rankService.updateRankAfterMatch(bId, oppTierB, 'win')
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
    await Promise.all(ids.map(async uid => {
      const sid = room.players.get(uid)!.sid
      const s = await this.settlePlayer(sid)
      statsMap.set(uid, s)
    }))
    // ranking: sort by score -> rare -> maxCombo, forfeit user forced last
    const sorted = [...ids].sort((a, b) => {
      if (forfeitUserId !== undefined) {
        if (a === forfeitUserId) return 1
        if (b === forfeitUserId) return -1
      }
      const sa = statsMap.get(a)!, sb = statsMap.get(b)!
      if (sa.score !== sb.score) return sb.score - sa.score
      if (sa.rareCount !== sb.rareCount) return sb.rareCount - sa.rareCount
      return sb.maxCombo - sa.maxCombo
    })
    const ranks = new Map<number, number>()
    sorted.forEach((uid, idx) => ranks.set(uid, idx + 1))
    // winner is rank 1 (if forfeit, winner is first non-forfeit)
    const winnerId = sorted[0]
    const winnerForDb = winnerId < 0 ? null : winnerId
    await this.matchRepo.update({ id: matchId }, { status: 'finished', winnerId: winnerForDb as unknown as number | null, endedAt: new Date() })
    const rows: MatchPlayerEntity[] = []
    for (const uid of ids) {
      const rp = room.players.get(uid)!
      const st = statsMap.get(uid)!
      rows.push(this.matchPlayerRepo.create({ matchId, userId: uid, score: st.score, rareCount: st.rareCount, maxCombo: st.maxCombo, rank: ranks.get(uid)!, sid: rp.sid, isAi: uid < 0, aiLevel: rp.aiLevel ?? null } as Partial<MatchPlayerEntity> as MatchPlayerEntity))
    }
    await this.matchPlayerRepo.save(rows)
    // rank updates for humans (simplified: rank 1 = win, else lose)
    for (const uid of ids) if (uid > 0) {
      const r = ranks.get(uid)!
      const oppAvg = 1 // simplified
      if (r === 1) await this.rankService.updateRankAfterMatch(uid, oppAvg, 'win')
      else await this.rankService.updateRankAfterMatch(uid, oppAvg, 'lose')
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

  private async settlePlayer(sid: string): Promise<PlayerStats> {
    const isAi = await this.redis.hget(`match_session:${sid}`, 'isAi')
    if (isAi === '1') {
      try {
        const sess = await this.redis.hgetall(`match_session:${sid}`)
        const score = parseInt(sess.score || '0', 10)
        const maxCombo = parseInt(sess.maxCombo || '0', 10)
        // rareCount approximate from found set not needed for AI tie-break detail; estimate 0
        return { score, rareCount: 0, maxCombo, foundWords: [] }
      } catch { return { score: 0, rareCount: 0, maxCombo: 0, foundWords: [] } }
    }
    try {
      const res = await this.gameService.endGame(sid)
      const rareCount = res.foundWords.filter(f => f.rarity === 'idiom' || f.rarity === 'rare').length
      return { score: res.score, rareCount, maxCombo: res.maxCombo, foundWords: res.foundWords }
    } catch { return { score: 0, rareCount: 0, maxCombo: 0, foundWords: [] } }
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
        if (r.type === 'pvp_4p') void this.finishMatch4p(matchId, userId, 'disconnect')
        else void this.finishMatch(matchId, userId, 'disconnect')
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
    // 随机有放回抽样，池常驻不剔除
    const entry = pool[Math.floor(Math.random() * pool.length)]
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
      const foundKey = `match_session:${sid}:found`
      const isDup = await this.redis.sismember(foundKey, entry.word)
      if (isDup) {
        // 重复词不计分，直接进入下一轮
        this.startAiDriving(room, aiId)
        return
      }
      const sess = await this.redis.hgetall(`match_session:${sid}`)
      const lastAt = parseInt(sess.lastWordAt || '0', 10)
      const now = Date.now()
      let combo = 0
      if (lastAt > 0 && now - lastAt <= 10000) combo = Math.min(parseInt(sess.combo || '0', 10) + 1, 10)
      let bonus = 0
      if (combo >= 9) bonus = 3
      else if (combo >= 6) bonus = 2
      else if (combo >= 3) bonus = 1
      const baseScore = calcScore(entry.length, entry.rarity as Rarity)
      const scoreDelta = baseScore + bonus
      const curScore = parseInt(sess.score || '0', 10)
      const curComboScore = parseInt(sess.comboScore || '0', 10)
      const newScore = curScore + scoreDelta
      const newMaxCombo = Math.max(parseInt(sess.maxCombo || '0', 10), combo)
      await this.redis.pipeline()
        .sadd(foundKey, entry.word)
        .hset(`match_session:${sid}`, { score: newScore.toString(), combo: combo.toString(), maxCombo: newMaxCombo.toString(), lastWordAt: now.toString(), comboScore: (curComboScore + bonus).toString() })
        .expire(foundKey, 600)
        .exec()
      await this.broadcastScores(room, true)
      this.startAiDriving(room, aiId)
    }, delay)
    room.aiTimers.set(aiId, t)
  }
}
