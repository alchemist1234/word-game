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

const QUEUE_TIMEOUT_MS = 30000
const DISCONNECT_GRACE_MS = 30000
const MATCH_DURATION = 180
const COUNTDOWN_SEC = 3
const MATCH_TIERS = [1, 2, 3, 4, 5, 6, 7]

interface RoomPlayer {
  sid: string
  clientConnected: boolean
  disconnectTimer?: NodeJS.Timeout
}

interface MatchRoom {
  matchId: string
  grid: string[][]
  size: number
  duration: number
  /** userId -> 玩家（2 人） */
  players: Map<number, RoomPlayer>
  status: 'countdown' | 'playing' | 'finished'
  remainingSec: number
  ticker?: NodeJS.Timeout
  lastScores: Map<number, number>
  lastMatchEnd?: {
    winnerUserId: number | null
    my: unknown
    opponent: unknown
  }
}

/**
 * 实时 1v1 对战服务（迭代6详细设计 §4-§6）
 * 匹配队列（Redis）→ 配对 → 房间（内存）→ 服务端权威计时 → 胜负落库
 */
@Injectable()
export class MatchService implements OnModuleDestroy {
  private readonly logger = new Logger(MatchService.name)
  /** 房间：matchId -> 对局（单实例；多实例部署时改 Redis 存储） */
  private readonly rooms = new Map<string, MatchRoom>()
  /** userId -> matchId（断线/广播定位房间） */
  private readonly playerMatch = new Map<number, string>()
  /** userId -> WS client（连接注册/广播同实例，避免 gateway 多实例导致映射隔离） */
  private readonly userClients = new Map<number, WebSocket>()

  /** WS 连接注册（GameGateway.handleConnection 调用） */
  registerClient(userId: number, client: WebSocket): void {
    this.userClients.set(userId, client)
  }

  /** WS 连接注销（GameGateway.handleDisconnect 调用） */
  unregisterClient(userId: number): void {
    this.userClients.delete(userId)
  }

  /** 广播给指定用户（对战房间推送） */
  broadcastToUser(userId: number, event: string, data: unknown): void {
    const client = this.userClients.get(userId)
    if (client && client.readyState === 1 /* OPEN */) {
      client.send(JSON.stringify({ event, data }))
    }
  }

  constructor(
    private readonly gameService: GameService,
    private readonly gridPoolService: GridPoolService,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(MatchEntity)
    private readonly matchRepo: Repository<MatchEntity>,
    @InjectRepository(MatchPlayerEntity)
    private readonly matchPlayerRepo: Repository<MatchPlayerEntity>,
  ) {}

  onModuleDestroy(): void {
    for (const room of this.rooms.values()) {
      if (room.ticker) clearInterval(room.ticker)
    }
  }

  // ===== 匹配队列 =====

  /** 入队（同 tier 队列；已在房间则直接返回对局信息） */
  async queue(userId: number): Promise<{ status: string; matchId?: string }> {
    const existing = this.playerMatch.get(userId)
    if (existing) {
      const room = this.rooms.get(existing)
      if (room && room.status !== 'finished') {
        return { status: 'matched', matchId: existing }
      }
      this.leaveMatch(userId, existing)
    }
    // 清理旧排队残留（避免重复入队导致自己配对自己）
    await this.cancelQueue(userId)
    const user = await this.userRepo.findOne({ where: { id: userId } })
    const tier = Math.min(Math.max(user?.rankTier ?? 1, 1), 7)
    await this.redis.rpush(`match_queue:${tier}`, userId.toString())
    await this.redis.hset(`match_queue_meta:${userId}`, {
      tier: tier.toString(),
      enqueuedAt: Date.now().toString(),
    })
    await this.tryPairQueue(tier)
    return { status: 'queued' }
  }

  /** 轮询队列状态：queued / matched / timeout（超时消费时出队） */
  async queueStatus(userId: number): Promise<{
    status: 'queued' | 'matched' | 'timeout'
    matchId?: string
    elapsedSec?: number
    grid?: string[][]
    size?: number
    duration?: number
    mySid?: string
    opponent?: { nickname: string; rankTier: number }
  }> {
    const meta = await this.redis.hgetall(`match_queue_meta:${userId}`)
    if (meta.tier) {
      const elapsed = Date.now() - parseInt(meta.enqueuedAt || '0', 10)
      if (elapsed > QUEUE_TIMEOUT_MS) {
        await this.cancelQueue(userId)
        return { status: 'timeout', elapsedSec: Math.floor(elapsed / 1000) }
      }
      return { status: 'queued', elapsedSec: Math.floor(elapsed / 1000) }
    }
    const matchId = this.playerMatch.get(userId)
    if (matchId) {
      const room = this.rooms.get(matchId)
      const player = room?.players.get(userId)
      if (room && player) {
        const opponentId = [...room.players.keys()].find((id) => id !== userId)
        const opponent = opponentId
          ? await this.userRepo.findOne({ where: { id: opponentId } })
          : null
        return {
          status: 'matched' as const,
          matchId,
          grid: room.grid,
          size: room.size,
          duration: room.duration,
          mySid: player.sid,
          opponent: {
            nickname: opponent?.nickname ?? `玩家${opponentId ?? ''}`,
            rankTier: opponent?.rankTier ?? 1,
          },
        }
      }
      return { status: 'matched', matchId }
    }
    return { status: 'timeout' }
  }

  /** 取消排队 */
  async cancelQueue(userId: number): Promise<{ cancelled: boolean }> {
    const meta = await this.redis.hgetall(`match_queue_meta:${userId}`)
    if (meta.tier) {
      await this.redis.lrem(`match_queue:${meta.tier}`, 0, userId.toString())
      await this.redis.del(`match_queue_meta:${userId}`)
      return { cancelled: true }
    }
    return { cancelled: false }
  }

  /** 配对扫描（每秒）：每队列成对取人；队列内清理超时者 */
  @Interval(1000)
  async scanQueues(): Promise<void> {
    for (const tier of MATCH_TIERS) {
      await this.tryPairQueue(tier)
    }
  }

  private async tryPairQueue(tier: number): Promise<void> {
    const key = `match_queue:${tier}`
    const ids = await this.redis.lrange(key, 0, -1)
    if (ids.length < 2) {
      // 清理超时者（少于 2 人时兜底清除）
      for (const idStr of ids) {
        const uid = parseInt(idStr, 10)
        const meta = await this.redis.hgetall(`match_queue_meta:${uid}`)
        if (meta.enqueuedAt && Date.now() - parseInt(meta.enqueuedAt, 10) > QUEUE_TIMEOUT_MS) {
          await this.redis.lrem(key, 0, idStr)
          await this.redis.del(`match_queue_meta:${uid}`)
        }
      }
      return
    }
    // 取前 2 人配对（跳过超时者）
    const picked: number[] = []
    for (const idStr of ids) {
      if (picked.length >= 2) break
      const uid = parseInt(idStr, 10)
      const meta = await this.redis.hgetall(`match_queue_meta:${uid}`)
      if (meta.enqueuedAt && Date.now() - parseInt(meta.enqueuedAt, 10) > QUEUE_TIMEOUT_MS) {
        await this.redis.lrem(key, 0, idStr)
        await this.redis.del(`match_queue_meta:${uid}`)
        continue
      }
      picked.push(uid)
      await this.redis.lrem(key, 0, idStr)
    }
    if (picked.length < 2) {
      // 不足两人：放回（仅在配对中途失败时；正常流程入队即触发 tryPairQueue）
      for (const uid of picked) {
        const meta = await this.redis.hgetall(`match_queue_meta:${uid}`)
        if (meta.tier) await this.redis.rpush(key, uid.toString())
      }
      return
    }
    const [a, b] = picked
    await this.redis.del(`match_queue_meta:${a}`, `match_queue_meta:${b}`)
    try {
      await this.setupMatch(a, b)
    } catch (e) {
      // 配对失败（如无网格）：放回队列，等待下轮
      this.logger.warn(`setupMatch failed: ${(e as Error).message}`)
      await this.redis.rpush(key, a.toString(), b.toString())
      await this.redis.hset(`match_queue_meta:${a}`, {
        tier: tier.toString(),
        enqueuedAt: Date.now().toString(),
      })
      await this.redis.hset(`match_queue_meta:${b}`, {
        tier: tier.toString(),
        enqueuedAt: Date.now().toString(),
      })
    }
  }

  // ===== 对局生命周期 =====

  /** 配对成功：取同网格 → 建双方会话 → 建房间 → 广播开局 */
  private async setupMatch(userIdA: number, userIdB: number): Promise<void> {
    const gridEntity = await this.gridPoolService.acquire('standard')
    if (!gridEntity) throw new NotFoundException('暂无可用网格')

    const matchId = uuidv4()
    const sessionA = await this.gameService.createSessionFromGrid(
      gridEntity, userIdA, MATCH_DURATION, matchId,
    )
    const sessionB = await this.gameService.createSessionFromGrid(
      gridEntity, userIdB, MATCH_DURATION, matchId,
    )

    await this.matchRepo.save(
      this.matchRepo.create({
        id: matchId,
        type: 'pvp_1v1',
        gridSeed: sessionA.gridSeed,
        grid: gridEntity.grid,
        targetWords: gridEntity.targetWords,
        status: 'ongoing',
        winnerId: null,
        endedAt: null,
      }),
    )

    const room: MatchRoom = {
      matchId,
      grid: gridEntity.grid,
      size: gridEntity.size,
      duration: MATCH_DURATION,
      players: new Map([
        [userIdA, { sid: sessionA.matchSessionId, clientConnected: true }],
        [userIdB, { sid: sessionB.matchSessionId, clientConnected: true }],
      ]),
      status: 'countdown',
      remainingSec: MATCH_DURATION + COUNTDOWN_SEC,
      lastScores: new Map([
        [userIdA, 0],
        [userIdB, 0],
      ]),
    }
    this.rooms.set(matchId, room)
    this.playerMatch.set(userIdA, matchId)
    this.playerMatch.set(userIdB, matchId)
    this.logger.log(`Match ${matchId}: user ${userIdA} vs ${userIdB}`)

    // 广播开局（双方各自视角）
    const [userA, userB] = await Promise.all([
      this.userRepo.findOne({ where: { id: userIdA } }),
      this.userRepo.findOne({ where: { id: userIdB } }),
    ])
    this.sendMatchStart(room, userIdA, sessionA.matchSessionId, userB)
    this.sendMatchStart(room, userIdB, sessionB.matchSessionId, userA)

    // 3s 倒计时后进入主计时
    setTimeout(() => {
      const r = this.rooms.get(matchId)
      if (!r || r.status !== 'countdown') return
      r.status = 'playing'
      r.remainingSec = MATCH_DURATION
      r.ticker = setInterval(() => void this.tick(matchId), 1000)
    }, COUNTDOWN_SEC * 1000)
  }

  private sendMatchStart(
    room: MatchRoom,
    myUserId: number,
    mySid: string,
    opponent: UserEntity | null,
  ): void {
    this.broadcastToUser(myUserId, 'match_start', {
      matchId: room.matchId,
      grid: room.grid,
      size: room.size,
      duration: room.duration,
      mySid,
      opponent: {
        nickname: opponent?.nickname ?? `玩家${opponent?.id ?? ''}`,
        rankTier: opponent?.rankTier ?? 1,
      },
    })
  }

  /** 每秒 tick：剩余时间递减 + 分数广播；归零结算 */
  private async tick(matchId: string): Promise<void> {
    const room = this.rooms.get(matchId)
    if (!room || room.status !== 'playing') return
    room.remainingSec--
    await this.broadcastScores(room, false)
    if (room.remainingSec <= 0) {
      await this.finishMatch(matchId)
    }
  }

  /** 读双方分数并广播 match_tick（提词触发时附对手得分飘字） */
  async broadcastScore(matchId: string): Promise<void> {
    const room = this.rooms.get(matchId)
    if (!room || room.status !== 'playing') return
    await this.broadcastScores(room, true)
  }

  private async broadcastScores(room: MatchRoom, withDelta: boolean): Promise<void> {
    const [aId, bId] = [...room.players.keys()]
    const pa = room.players.get(aId)!
    const pb = room.players.get(bId)!
    const pipe = this.redis.pipeline()
    pipe.hgetall(`match_session:${pa.sid}`)
    const results = await pipe.exec()
    if (!results) return
    const readScore = (res: [Error | null, unknown] | null, fallback: number): number =>
      res && !res[0]
        ? parseInt((res[1] as Record<string, string>).score || '0', 10)
        : fallback
    const scoreA = readScore(results[0], room.lastScores.get(aId) ?? 0)
    const scoreB = readScore(results[1], room.lastScores.get(bId) ?? 0)
    const comboA = results[0] && !results[0][0]
      ? parseInt((results[0][1] as Record<string, string>).combo || '0', 10)
      : 0
    const comboB = results[1] && !results[1][0]
      ? parseInt((results[1][1] as Record<string, string>).combo || '0', 10)
      : 0

    const deltaA = scoreA - (room.lastScores.get(aId) ?? 0)
    const deltaB = scoreB - (room.lastScores.get(bId) ?? 0)
    room.lastScores.set(aId, scoreA)
    room.lastScores.set(bId, scoreB)

    // 双方各自视角
    this.broadcastToUser(aId, 'match_tick', {
      remainingSec: room.remainingSec,
      myScore: scoreA,
      opponentScore: scoreB,
      myCombo: comboA,
      opponentCombo: comboB,
    })
    this.broadcastToUser(bId, 'match_tick', {
      remainingSec: room.remainingSec,
      myScore: scoreB,
      opponentScore: scoreA,
      myCombo: comboB,
      opponentCombo: comboA,
    })
    if (withDelta) {
      if (deltaB > 0) {
        this.broadcastToUser(aId, 'match_opponent_score', {
          delta: deltaB,
          total: scoreB,
        })
      }
      if (deltaA > 0) {
        this.broadcastToUser(bId, 'match_opponent_score', {
          delta: deltaA,
          total: scoreA,
        })
      }
    }
  }

  // ===== 结算 =====

  /** 时间到/断线超时：双方结算 → 胜负判定 → 落库 → 广播 match_end */
  private async finishMatch(matchId: string, forfeitUserId?: number): Promise<void> {
    const room = this.rooms.get(matchId)
    if (!room || room.status === 'finished') return
    room.status = 'finished'
    if (room.ticker) clearInterval(room.ticker)
    room.ticker = undefined

    const [aId, bId] = [...room.players.keys()]
    const pa = room.players.get(aId)!
    const pb = room.players.get(bId)!

    // 双方结算（图鉴收集 + foundWords），会话异常时按 0 分兜底
    const [statsA, statsB] = await Promise.all([
      this.settlePlayer(pa.sid),
      this.settlePlayer(pb.sid),
    ])

    const winner = decideWinner(statsA, statsB)
    // 断线判负：断线方为负，胜者为对方（GDD §4.2.2 断线 30s 超时判负）
    const forfeitWinner =
      forfeitUserId === undefined
        ? winner
        : forfeitUserId === aId
          ? 2
          : forfeitUserId === bId
            ? 1
            : winner
    const winnerUserId =
      forfeitWinner === 0 ? null : forfeitWinner === 1 ? aId : bId

    // 落库
    const endedAt = new Date()
    await this.matchRepo.update(
      { id: matchId },
      {
        status: 'finished',
        winnerId: winnerUserId,
        endedAt,
      },
    )
    const rankA = winner === 2 ? 2 : 1
    const rankB = winner === 1 ? 2 : 1
    await this.matchPlayerRepo.save([
      this.matchPlayerRepo.create({
        matchId, userId: aId, score: statsA.score,
        rareCount: statsA.rareCount, maxCombo: statsA.maxCombo,
        rank: rankA, sid: pa.sid,
      }),
      this.matchPlayerRepo.create({
        matchId, userId: bId, score: statsB.score,
        rareCount: statsB.rareCount, maxCombo: statsB.maxCombo,
        rank: rankB, sid: pb.sid,
      }),
    ])

    // 广播（双方各自视角）
    const endA = {
      matchId,
      winnerUserId,
      won: winner === 1,
      my: statsA,
      opponent: statsB,
    }
    const endB = {
      matchId,
      winnerUserId,
      won: winner === 2,
      my: statsB,
      opponent: statsA,
    }
    room.lastMatchEnd = endA
    this.broadcastToUser(aId, 'match_end', endA)
    this.broadcastToUser(bId, 'match_end', endB)

    // 清理
    this.playerMatch.delete(aId)
    this.playerMatch.delete(bId)
    this.rooms.delete(matchId)
    this.logger.log(`Match ${matchId} finished: A=${statsA.score} B=${statsB.score}`)
  }

  /** 单方结算：endGame（图鉴收集）+ rareCount 统计 */
  private async settlePlayer(sid: string): Promise<PlayerStats> {
    try {
      const res = await this.gameService.endGame(sid)
      const rareCount = res.foundWords.filter(
        (f) => f.rarity === 'idiom' || f.rarity === 'rare',
      ).length
      return {
        score: res.score,
        rareCount,
        maxCombo: res.maxCombo,
        foundWords: res.foundWords,
      }
    } catch {
      return { score: 0, rareCount: 0, maxCombo: 0, foundWords: [] }
    }
  }

  // ===== 断线重连 =====

  /** WS 断开：标记断线，30s 宽限；超时判负 */
  handleDisconnect(userId: number): void {
    const matchId = this.playerMatch.get(userId)
    if (!matchId) return
    const room = this.rooms.get(matchId)
    if (!room || room.status === 'finished') return
    const player = room.players.get(userId)
    if (!player) return
    player.clientConnected = false
    player.disconnectTimer = setTimeout(() => {
      const r = this.rooms.get(matchId)
      const p = r?.players.get(userId)
      if (r && p && !p.clientConnected && r.status !== 'finished') {
        this.logger.warn(`Match ${matchId}: user ${userId} disconnected > ${DISCONNECT_GRACE_MS}ms, forfeit`)
                void this.finishMatch(matchId, userId)
      }
    }, DISCONNECT_GRACE_MS)
  }

  /** WS 重连（match_join）：恢复房间 + 补发当前状态 */
  async handleJoin(userId: number, matchId: string): Promise<void> {
    const room = this.rooms.get(matchId)
    if (!room) return
    const player = room.players.get(userId)
    if (!player) return
    player.clientConnected = true
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer)
      player.disconnectTimer = undefined
    }

    if (room.status === 'finished' && room.lastMatchEnd) {
      this.broadcastToUser(userId, 'match_end', room.lastMatchEnd)
      return
    }

    const opponentId = [...room.players.keys()].find((id) => id !== userId)!
    const opponent = await this.userRepo.findOne({ where: { id: opponentId } })
    const session = await this.redis.hgetall(`match_session:${player.sid}`)
    const myScore = parseInt(session.score || '0', 10)
    const oppSession = await this.redis.hgetall(
      `match_session:${room.players.get(opponentId)!.sid}`,
    )
    const oppScore = parseInt(oppSession.score || '0', 10)
    this.broadcastToUser(userId, 'match_restore', {
      matchId,
      remainingSec: room.remainingSec,
      myScore,
      opponentScore: oppScore,
      grid: room.grid,
      size: room.size,
      mySid: player.sid,
      opponent: {
        nickname: opponent?.nickname ?? `玩家${opponentId}`,
        rankTier: opponent?.rankTier ?? 1,
      },
    })
  }

  /** 对局结束/异常时清理玩家归属 */
  private leaveMatch(userId: number, matchId: string): void {
    this.playerMatch.delete(userId)
    const room = this.rooms.get(matchId)
    if (room) room.players.delete(userId)
  }
}
