import type { CellPos } from '../core/types'

/**
 * 后端 API 层（对齐迭代2详细设计 §8.2）
 * H5 用 fetch；小程序端后续改 uni.request（技术债）
 */
const BASE = '/api'

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
}

export interface EndGameResponse {
  score: number
  foundWords: Array<{ word: string; score: number; rarity: string }>
}

export async function fetchGrid(
  size = 5,
  difficulty = 'standard',
): Promise<GridResponse> {
  const res = await fetch(
    `${BASE}/game/grid?size=${size}&difficulty=${difficulty}`,
  )
  if (!res.ok) throw new Error(`fetchGrid failed: ${res.status}`)
  return res.json() as Promise<GridResponse>
}

export async function submitWord(
  matchSessionId: string,
  word: string,
  cells: CellPos[],
): Promise<SubmitWordResponse> {
  const res = await fetch(`${BASE}/game/word`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchSessionId, word, cells }),
  })
  if (!res.ok) throw new Error(`submitWord failed: ${res.status}`)
  return res.json() as Promise<SubmitWordResponse>
}

export async function endGame(matchSessionId: string): Promise<EndGameResponse> {
  const res = await fetch(`${BASE}/game/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchSessionId }),
  })
  if (!res.ok) throw new Error(`endGame failed: ${res.status}`)
  return res.json() as Promise<EndGameResponse>
}
