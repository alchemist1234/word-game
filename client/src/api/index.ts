import type { CellPos } from '../core/types'

const BASE = '/api'

// token 管理（双端兼容 uni storage）
function getToken(): string {
  return uni.getStorageSync('token') || ''
}
function setToken(token: string): void {
  uni.setStorageSync('token', token)
}
function clearToken(): void {
  uni.removeStorageSync('token')
}

// 请求封装：自动带 Authorization + 401 跳登录
async function request(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${url}`, { ...options, headers })
  if (res.status === 401) {
    clearToken()
    uni.reLaunch({ url: '/pages/Login/index' })
    throw new Error('未授权，请重新登录')
  }
  return res
}

export { getToken, setToken, clearToken }

// ===== Auth API =====
export async function login(
  platform: string,
  phone: string,
  code: string,
): Promise<{ token: string; user: { id: number; nickname: string; chapterCurrent: number } }> {
  const res = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ platform, phone, code }),
  })
  if (!res.ok) throw new Error('登录失败')
  return res.json()
}

export async function sendSmsCode(phone: string): Promise<{ sent: boolean }> {
  const res = await request('/auth/sms-code', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  })
  return res.json()
}

// ===== Game API =====
export interface GridResponse {
  matchSessionId: string
  grid: string[][]
  size: number
  duration: number
}
export interface SubmitWordResponse {
  valid: boolean
  reason?: string
  score?: number
  rarity?: string
  totalScore?: number
  combo?: number
  comboBonus?: number
  comboRemainingMs?: number
  perfect?: boolean
  perfectBonus?: number
  remainingSec?: number
}

export interface EndGameResponse {
  score: number
  comboScore: number
  maxCombo: number
  potentialCount: number
  perfect: boolean
  perfectBonus: number
  foundWords: Array<{ word: string; score: number; rarity: string }>
  unfoundWords: Array<{ word: string; rarity: string }>
}
export async function fetchGrid(
  size = 5,
  difficulty = 'standard',
): Promise<GridResponse> {
  const res = await request(`/game/grid?size=${size}&difficulty=${difficulty}`)
  if (!res.ok) throw new Error('获取网格失败')
  return res.json()
}

export async function submitWord(
  matchSessionId: string,
  word: string,
  cells: CellPos[],
): Promise<SubmitWordResponse> {
  const res = await request('/game/word', {
    method: 'POST',
    body: JSON.stringify({ matchSessionId, word, cells }),
  })
  if (!res.ok) throw new Error('提词失败')
  return res.json()
}

export async function endGame(matchSessionId: string): Promise<EndGameResponse> {
  const res = await request('/game/end', {
    method: 'POST',
    body: JSON.stringify({ matchSessionId }),
  })
  if (!res.ok) throw new Error('结算失败')
  return res.json()
}

// ===== Level API =====
export interface LevelStartResponse {
  matchSessionId: string
  grid: string[][]
  size: number
  duration: number
  objective: { type: string; target?: number; score?: number; char?: string }
  stars: number[]
  title: string
  boss?: boolean
}
export interface LevelSubmitResponse extends EndGameResponse {
  stars: number
  objectiveMet: boolean
  canNext: boolean
  nextLevelId: string | null
  newUnlocked: string[]
}
export interface ChaptersResponse {
  chapters: Array<{
    chapter: number
    title: string
    unlocked: boolean
    levels: Array<{ id: string; title: string; stars: number; unlocked: boolean; boss?: boolean }>
  }>
}

export async function fetchChapters(): Promise<ChaptersResponse> {
  const res = await request('/level/chapters')
  if (!res.ok) throw new Error('获取章节失败')
  return res.json()
}

export async function startLevel(levelId: string): Promise<LevelStartResponse> {
  const res = await request('/level/start', {
    method: 'POST',
    body: JSON.stringify({ levelId }),
  })
  if (!res.ok) throw new Error('开始关卡失败')
  return res.json()
}

export async function submitLevel(
  matchSessionId: string,
): Promise<LevelSubmitResponse> {
  const res = await request('/level/submit', {
    method: 'POST',
    body: JSON.stringify({ matchSessionId }),
  })
  if (!res.ok) throw new Error('提交关卡失败')
  return res.json()
}

// ===== Pokedex API =====
export interface PokedexResponse {
  words: Array<{ word: string; rarity: string; foundCount: number; firstFoundAt: string }>
  total: number
  collected: number
}

export async function fetchPokedex(): Promise<PokedexResponse> {
  const res = await request('/pokedex')
  if (!res.ok) throw new Error('获取图鉴失败')
  return res.json()
}

// ===== Match API（迭代6：实时 1v1 对战） =====
export interface MatchQueueResponse {
  status: 'queued' | 'matched' | 'timeout'
  matchId?: string
  elapsedSec?: number
  grid?: string[][]
  size?: number
  duration?: number
  mySid?: string
  opponent?: { nickname: string; rankTier: number }
}

/** 入队匹配（对战固定 standard 5×5，180s） */
export async function queueMatch(): Promise<{ status: string; matchId?: string }> {
  const res = await request('/match/queue', { method: 'POST' })
  if (!res.ok) throw new Error('匹配入队失败')
  return res.json()
}

/** 轮询匹配状态：queued / matched / timeout */
export async function matchQueueStatus(): Promise<MatchQueueResponse> {
  const res = await request('/match/queue')
  if (!res.ok) throw new Error('匹配状态查询失败')
  return res.json()
}

/** 取消排队 */
export async function cancelMatchQueue(): Promise<{ cancelled: boolean }> {
  const res = await request('/match/queue', { method: 'DELETE' })
  if (!res.ok) throw new Error('取消匹配失败')
  return res.json()
}
