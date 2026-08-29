import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets'
import { Logger, Injectable, Inject, forwardRef } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { GameService } from './game.service'
import { MatchService } from '../match/match.service'
import type { CellPos } from '../grid-gen/types'
/** client -> userId 映射（单实例，迭代6多实例时改 Redis） */
const clientData = new WeakMap<WebSocket, { userId: number }>()

/**
 * WebSocket 网关（迭代5：划词判定优化 + 迭代6：对战广播/断线）
 * 用 ws 平台（@nestjs/platform-ws），非 socket.io（uni-app 跨端原生兼容）
 * 高频 submitWord + 对战事件；低频 API 仍走 HTTP
 */

@Injectable()
@WebSocketGateway({ path: '/api/game/ws' })
export class GameGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  private readonly logger = new Logger(GameGateway.name)

  constructor(
    private readonly gameService: GameService,
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => MatchService))
    private readonly matchService: MatchService,
  ) {}

  afterInit(): void {
    this.logger.log('WebSocket Gateway initialized at /api/game/ws')
  }

  /** 连接时验 JWT（token 从 query 参数取） */
  handleConnection(client: WebSocket, req?: IncomingMessage): void {
    try {
      const url = new URL(req?.url ?? '', 'http://localhost')
      const token = url.searchParams.get('token')
      if (!token) {
        client.close(4001, 'no token')
        return
      }
      const payload = this.jwtService.verify<{
        userId: number
        platform: string
      }>(token)
            // bigint 列经 JWT 为字符串，统一转数字（否则 Map key 类型不一致广播失配）
      const userId = Number(payload.userId)
      clientData.set(client, { userId })
      this.matchService.registerClient(userId, client)
      this.logger.log(`Client connected: userId=${payload.userId}`)
    } catch {
      client.close(4001, 'invalid token')
    }
  }

  handleDisconnect(client: WebSocket): void {
    const data = clientData.get(client)
    clientData.delete(client)
    if (data) {
      this.matchService.unregisterClient(data.userId)
      // 对战中断线：通知 MatchService 启动 30s 宽限
      this.matchService.handleDisconnect(data.userId)
      this.logger.log(`Client disconnected: userId=${data.userId}`)
    }
  }

  /** 提词校验（高频，从 HTTP 迁移到 WebSocket） */
  @SubscribeMessage('submit_word')
  async handleSubmitWord(
    client: WebSocket,
    payload: { sid: string; word: string; cells: number[][] },
  ): Promise<{ event: string; data: unknown }> {
    const data = clientData.get(client)
    if (!data) {
      return { event: 'error', data: { message: 'unauthorized' } }
    }
    try {
      const cells: CellPos[] = payload.cells.map(([row, col]) => ({
        row,
        col,
      }))
      const result = await this.gameService.submitWord(
        payload.sid,
        payload.word,
        cells,
      )
      // 对战会话：提词成功后广播双方分数（增量 <1s 感知）
      if (result.valid && result.matchId) {
        void this.matchService.broadcastScore(result.matchId)
      }
      return { event: 'word_result', data: result }
    } catch (e) {
      return { event: 'error', data: { message: (e as Error).message } }
    }
  }

  /** 对局重连（断线 30s 内恢复房间） */
  @SubscribeMessage('match_join')
  async handleMatchJoin(
    client: WebSocket,
    payload: { matchId: string },
  ): Promise<{ event: string; data: unknown }> {
    const data = clientData.get(client)
    if (!data) {
      return { event: 'error', data: { message: 'unauthorized' } }
    }
    if (!payload?.matchId) {
      return { event: 'error', data: { message: 'missing matchId' } }
    }
    this.matchService.registerClient(data.userId, client)
    await this.matchService.handleJoin(data.userId, payload.matchId)
    return { event: 'match_join_ack', data: { matchId: payload.matchId } }
  }

  /** 心跳 */
  @SubscribeMessage('ping')
  handlePing(): { event: string; data: unknown } {
    return { event: 'pong', data: null }
  }
}
