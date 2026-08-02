import type { CellPos, Rarity } from '../grid-gen/types'

/**
 * 提词校验 + 计分纯逻辑（迁移自迭代1 wordCheck.ts + score.ts）
 * 不依赖 Nest.js 运行时，可独立单测
 * 对齐 GDD §2.4
 */

/** 字数基础分（对齐 GDD §2.4.1） */
const BASE_SCORE: Record<number, number> = {
  2: 2,
  3: 5,
  4: 10,
  5: 20,
  6: 35,
}

/** 稀有度系数（对齐 GDD §2.4.2） */
const RARITY_MULT: Record<Rarity, number> = {
  common: 1.0,
  normal: 1.3,
  rare: 1.8,
  idiom: 2.5,
}

/** 计分：字数基础分 × 稀有度系数，四舍五入（对齐 GDD §2.4）连击奖励单独加 */
export function calcScore(length: number, rarity: Rarity): number {
  const base = BASE_SCORE[length] ?? 35
  return Math.round(base * RARITY_MULT[rarity])
}

/**
 * 连击固定加分（替代倍率，避免找词顺序影响总分）：
 * 3-5 连击每次 +1，6-8 连击每次 +2，9+ 连击每次 +3
 */
export function calcComboBonus(combo: number): number {
  if (combo >= 9) return 3
  if (combo >= 6) return 2
  if (combo >= 3) return 1
  return 0
}

/** 判定两格是否 8 向相邻（与 grid-gen 的 DIRS 一致） */
export function isAdjacent(a: CellPos, b: CellPos): boolean {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col)) === 1
}

/** 路径是否有重复格子 */
export function hasDuplicateCell(cells: CellPos[]): boolean {
  const seen = new Set<string>()
  for (const c of cells) {
    const k = `${c.row},${c.col}`
    if (seen.has(k)) return true
    seen.add(k)
  }
  return false
}

export type CheckFailReason = 'path_invalid' | 'not_in_dict' | 'duplicate'

export interface PathValidation {
  valid: boolean
  reason?: CheckFailReason
}

/** 校验路径合法性：至少 2 字、逐对 8 向相邻、无重复格 */
export function validatePath(cells: CellPos[]): PathValidation {
  if (cells.length < 2) return { valid: false, reason: 'path_invalid' }
  for (let i = 1; i < cells.length; i++) {
    if (!isAdjacent(cells[i - 1], cells[i])) {
      return { valid: false, reason: 'path_invalid' }
    }
  }
  if (hasDuplicateCell(cells)) return { valid: false, reason: 'path_invalid' }
  return { valid: true }
}
