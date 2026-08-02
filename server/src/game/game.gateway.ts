import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets'
import { Logger, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { GameService } from './game.service'
import type { CellPos } from '../grid-gen/types'

/** client -> userId 映射（单实例，迭代6多实例时改 Redis） */
const clientData = new WeakMap<WebSocket, { userId: number }>()

/**
 * WebSocket 网关（迭代5：划词判定优化）
 * 用 ws 平台（@nestjs/platform-ws），非 socket.io（uni-app 跨端原生兼容）
 * 仅处理高频的 submitWord，低频 API 仍走 HTTP
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
      clientData.set(client, { userId: payload.userId })
      this.logger.log(`Client connected: userId=${payload.userId}`)
    } catch {
      client.close(4001, 'invalid token')
    }
  }

  handleDisconnect(client: WebSocket): void {
    clientData.delete(client)
    this.logger.log('Client disconnected')
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
      return { event: 'word_result', data: result }
    } catch (e) {
      return { event: 'error', data: { message: (e as Error).message } }
    }
  }

  /** 心跳 */
  @SubscribeMessage('ping')
  handlePing(): { event: string; data: unknown } {
    return { event: 'pong', data: null }
  }
}
