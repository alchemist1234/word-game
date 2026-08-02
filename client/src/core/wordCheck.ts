import type { CellPos, CheckResult, DictWord, FoundWord } from './types'
import { calcScore } from './score'

/** 提词校验上下文：词库索引 + 本局已找到词 */
export interface WordCheckContext {
  wordSet: Set<string>
  wordMap: Map<string, DictWord>
  foundWords: FoundWord[]
}

/** 判定两格是否 8 向相邻（与 gridGen 的 DIRS 一致） */
export function isAdjacent(a: CellPos, b: CellPos): boolean {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col)) === 1
}

/** 路径是否有重复格子 */
function hasDuplicateCell(cells: CellPos[]): boolean {
  const seen = new Set<string>()
  for (const c of cells) {
    const k = `${c.row},${c.col}`
    if (seen.has(k)) return true
    seen.add(k)
  }
  return false
}

/**
 * 提词校验：路径合法 + 词在词库 + 未重复，返回计分信息
 * 对齐详细设计 §5.2
 */
export function checkWord(
  word: string,
  cells: CellPos[],
  ctx: WordCheckContext,
): CheckResult {
  // 1. 路径合法性：至少 2 字、逐对相邻、无重复格
  if (cells.length < 2) return { valid: false, reason: 'path_invalid' }
  for (let i = 1; i < cells.length; i++) {
    if (!isAdjacent(cells[i - 1], cells[i])) {
      return { valid: false, reason: 'path_invalid' }
    }
  }
  if (hasDuplicateCell(cells)) return { valid: false, reason: 'path_invalid' }

  // 2. 词在词库
  if (!ctx.wordSet.has(word)) return { valid: false, reason: 'not_in_dict' }

  // 3. 未重复（同一词一局只计一次）
  if (ctx.foundWords.some((f) => f.word === word)) {
    return { valid: false, reason: 'duplicate' }
  }

  // 4. 计分
  const dw = ctx.wordMap.get(word)
  if (!dw) return { valid: false, reason: 'not_in_dict' }
  return { valid: true, score: calcScore(dw), rarity: dw.rarity }
}
