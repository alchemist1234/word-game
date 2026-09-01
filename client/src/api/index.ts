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

// ===== Match API（迭代6：实时 1v1 对战，迭代8：4人混战） =====
export interface MatchQueueResponse {
  status: 'queued' | 'matched' | 'timeout'
  matchId?: string
  elapsedSec?: number
  grid?: string[][]
  size?: number
  duration?: number
  mySid?: string
  opponent?: { nickname: string; rankTier: number }
  players?: Array<{ userId: number; nickname: string; rankTier: number; isAi: boolean }>
}

/** 入队匹配（8a：支持 size=4 四人混战，mode=ranked 段位赛） */
export async function queueMatch(opts?: { size?: number; mode?: string }): Promise<{ status: string; matchId?: string }> {
  const res = await request('/match/queue', { method: 'POST', body: JSON.stringify(opts ?? {}) })
  if (!res.ok) throw new Error('匹配入队失败')
  return res.json()
}

/** 轮询匹配状态：queued / matched / timeout（8a：size=4 查询4人队列） */
export async function matchQueueStatus(size?: number): Promise<MatchQueueResponse> {
  const qs = size === 4 ? '?size=4' : ''
  const res = await request(`/match/queue${qs}`)
  if (!res.ok) throw new Error('匹配状态查询失败')
  return res.json()
}

/** 取消排队 */
export async function cancelMatchQueue(size?: number): Promise<{ cancelled: boolean }> {
  const qs = size === 4 ? '?size=4' : ''
  const res = await request(`/match/queue${qs}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('取消匹配失败')
  return res.json()
}

/** 主动离开对战：服务端立即判负，对方直接获胜（与得分无关） */
export async function abandonMatch(): Promise<{ ok: boolean }> {
  const res = await request('/match/abandon', { method: 'POST' })
  if (!res.ok) throw new Error('离开对战失败')
  return res.json()
}

// ===== Challenge API（迭代7：好友挑战） =====
export interface ChallengeDetailResponse {
  id: string
  gridSeed: string
  duration: number
  challenger: { userId: number; nickname: string; score: number }
  stats: { attemptCount: number; bestScore: number; bestNickname: string | null }
  myBest: number | null
  beatChallenger: boolean
}
export interface ChallengeStartResponse {
  matchSessionId: string
  grid: string[][]
  size: number
  duration: number
  challenger: { nickname: string; score: number }
}
export interface ChallengeSubmitResponse {
  saved: boolean
  beat: boolean
  my: { score: number; maxCombo: number; foundCount: number; foundWords: Array<{ word: string; score: number; rarity: string }> }
  challenger: { nickname: string; score: number }
  rank: number
}
export async function createChallenge(matchSessionId: string): Promise<{ challengeId: string }> {
  const res = await request('/challenge/create', { method: 'POST', body: JSON.stringify({ matchSessionId }) })
  if (!res.ok) throw new Error('创建挑战失败')
  return res.json()
}
export async function fetchChallengeDetail(id: string): Promise<ChallengeDetailResponse> {
  const res = await request(`/challenge/${id}`)
  if (!res.ok) throw new Error('获取挑战失败')
  return res.json()
}
export async function startChallengeRequest(id: string): Promise<ChallengeStartResponse> {
  const res = await request(`/challenge/${id}/start`, { method: 'POST' })
  if (!res.ok) throw new Error('开始挑战失败')
  return res.json()
}
export async function submitChallengeRequest(id: string, matchSessionId: string): Promise<ChallengeSubmitResponse> {
  const res = await request(`/challenge/${id}/submit`, { method: 'POST', body: JSON.stringify({ matchSessionId }) })
  if (!res.ok) throw new Error('提交挑战失败')
  return res.json()
}
export async function fetchMyChallenges(): Promise<{ challenges: Array<{ challengeId: string; createdAt: string; challengerScore: number; attemptCount: number; bestScore: number; bestNickname: string | null; beaten: boolean }> }> {
  const res = await request('/challenge/mine')
  if (!res.ok) throw new Error('获取我的挑战失败')
  return res.json()
}

// ===== Daily API（迭代7：每日挑战） =====
export interface DailyInfoResponse {
  date: string
  size: number
  duration: number
  attemptsUsed: number
  attemptsLeft: number
  myBest: number | null
}
export interface DailyStartResponse {
  matchSessionId: string
  grid: string[][]
  size: number
  duration: number
  date: string
  attemptsLeft: number
}
export interface DailySubmitResponse {
  saved: boolean
  score: number
  attemptsLeft: number
  myBest: number
  maxCombo: number
  foundCount: number
  foundWords: Array<{ word: string; score: number; rarity: string }>
}
export async function fetchDailyInfo(): Promise<DailyInfoResponse> {
  const res = await request('/daily')
  if (!res.ok) throw new Error('获取每日挑战失败')
  return res.json()
}
export async function startDailyRequest(): Promise<DailyStartResponse> {
  const res = await request('/daily/start', { method: 'POST' })
  if (!res.ok) throw new Error('开始每日挑战失败')
  return res.json()
}
export async function submitDailyRequest(matchSessionId: string): Promise<DailySubmitResponse> {
  const res = await request('/daily/submit', { method: 'POST', body: JSON.stringify({ matchSessionId }) })
  if (!res.ok) throw new Error('提交每日挑战失败')
  return res.json()
}

// ===== Leaderboard API（迭代7：排行榜） =====
export interface LeaderboardResponse {
  type: string
  period: string
  mine: { userId: number; nickname: string; score: number; rank: number } | null
  list: Array<{ userId: number; nickname: string; score: number }>
}
export async function fetchLeaderboard(type: string): Promise<LeaderboardResponse> {
  const res = await request(`/leaderboard?type=${type}`)
  if (!res.ok) throw new Error('获取排行榜失败')
  return res.json()
}

// ===== Economy API（迭代8a） =====
export interface EconomyResponse {
  coins: number
  diamonds: number
  stamina: number
  maxStamina: number
  nextRecoverAt: string | null
  rankTier: number
  rankScore: number
}
export async function fetchEconomy(): Promise<EconomyResponse> {
  const res = await request('/economy/me')
  if (!res.ok) throw new Error('获取经济信息失败')
  return res.json()
}

// ===== Rank API（迭代8a） =====
export interface RankResponse {
  rankTier: number
  rankScore: number
  wins: number
  losses: number
  draws: number
  winRate: number
  season: string
}
export async function fetchRankMe(): Promise<RankResponse> {
  const res = await request('/rank/me')
  if (!res.ok) throw new Error('获取段位失败')
  return res.json()
}
