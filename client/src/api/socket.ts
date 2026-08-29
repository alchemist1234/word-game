/**
 * WebSocket 客户端（迭代5：划词判定优化）
 * uni-app 跨端兼容（H5 用浏览器 WebSocket，小程序用 uni.connectSocket）
 * 全局长连接（登录后建连），心跳保活，断线指数退避重连
 */
import { getToken } from './index'

export interface WsMessage {
  event: string
  data: unknown
}

let socketTask: UniApp.SocketTask | null = null
let messageHandler: ((msg: WsMessage) => void) | null = null
let statusHandler: ((connected: boolean) => void) | null = null
let reconnectAttempts = 0
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let shouldReconnect = true

function buildWsUrl(token: string): string {
  // #ifdef H5
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/api/game/ws?token=${token}`
  // #endif
  // #ifndef H5
  // 非H5：需配置后端地址（迭代6切真机时处理）
  return `ws://localhost:3000/api/game/ws?token=${token}`
  // #endif
}

function doConnect(token: string): void {
  const url = buildWsUrl(token)
  socketTask = uni.connectSocket({
    url,
    complete: () => {},
  })

  socketTask.onOpen(() => {
    console.log('[WS] connected')
    reconnectAttempts = 0
    statusHandler?.(true)
    // 心跳：每 30s 发 ping
    heartbeatTimer = setInterval(() => {
      sendWs('ping', null)
    }, 30000)
  })

  socketTask.onMessage((res: { data: string | ArrayBuffer }) => {
    try {
      const data =
        typeof res.data === 'string'
          ? res.data
          : new TextDecoder().decode(res.data)
      const msg = JSON.parse(data) as WsMessage
      messageHandler?.(msg)
    } catch (e) {
      console.error('[WS] message parse error', e)
    }
  })

  socketTask.onClose(() => {
    console.log('[WS] closed')
    statusHandler?.(false)
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    socketTask = null
    // 断线重连：指数退避（1s -> 2s -> 4s -> 8s -> 16s，最多 5 次）
    if (shouldReconnect && reconnectAttempts < 5) {
      const delay = 1000 * Math.pow(2, reconnectAttempts)
      reconnectAttempts++
      setTimeout(() => {
        const token = getToken()
        if (token) doConnect(token)
      }, delay)
    }
  })

  socketTask.onError((err: unknown) => {
    console.error('[WS] error', err)
  })
}

/** 建立 WebSocket 连接（登录后调用） */
export function connectSocket(
  token: string,
  onMessage: (msg: WsMessage) => void,
  onStatus?: (connected: boolean) => void,
): void {
  // 已连接则只更新 handler，不重复建连
  if (socketTask) {
    messageHandler = onMessage
    if (onStatus) statusHandler = onStatus
    return
  }
  messageHandler = onMessage
  statusHandler = onStatus ?? null
  shouldReconnect = true
  reconnectAttempts = 0
  doConnect(token)
}

/** 发送 WebSocket 消息 */
export function sendWs(event: string, data: unknown): void {
  if (socketTask) {
    socketTask.send({
      data: JSON.stringify({ event, data }),
      fail: (err: unknown) => console.error('[WS] send failed', err),
    })
  } else {
    console.warn('[WS] not connected, cannot send', event)
  }
}

/** 断开连接（退出登录时调用） */
export function disconnectSocket(): void {
  shouldReconnect = false
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (socketTask) {
    socketTask.close({})
    socketTask = null
  }
}

/** 检查 WebSocket 是否已连接 */
export function isWsConnected(): boolean {
  return socketTask !== null
}
