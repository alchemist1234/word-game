import type { CellPos, DictWord, GeneratedGrid } from './types'

/**
 * 网格生成器（简化版，技术债 #1，迭代 2 换 Go 服务端版）
 * 对齐详细设计 §5.1
 *
 * 策略：从词库选候选词 -> 回溯为每个词找相邻空闲路径放置（字可复用）
 *      -> 剩余空格填高频字 -> 保证至少 minTarget 个目标词可连
 */

/** 高频填充字池（用于剩余空格，增加偶然成词） */
export const FILLER_CHARS = [
  '的', '了', '是', '在', '有', '人', '这', '中', '大', '为',
  '上', '个', '国', '我', '以', '要', '他', '时', '来', '用',
  '们', '生', '到', '作', '地', '于', '出', '就', '分', '对',
  '成', '会', '可', '主', '发', '年', '动', '同', '工', '能',
  '下', '长', '子', '多', '后', '也', '家', '看', '起', '你',
  '都', '把', '好', '里', '还', '天', '过', '没', '者', '小',
  '道', '说', '前', '得', '然', '外', '本', '开', '比', '但',
  '高', '已', '身', '进', '化', '被', '两', '新', '民', '只',
  '明', '心', '事', '日', '水', '手', '口', '目',
]

/** 8 向偏移（与 wordCheck.isAdjacent 严格一致） */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
]

function makeEmpty(size: number): (string | null)[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null),
  )
}

function inBounds(cell: CellPos, size: number): boolean {
  return cell.row >= 0 && cell.row < size && cell.col >= 0 && cell.col < size
}

function cellKey(cell: CellPos): string {
  return `${cell.row},${cell.col}`
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function allCells(size: number): CellPos[] {
  const cells: CellPos[] = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      cells.push({ row: r, col: c })
    }
  }
  return cells
}

/** 回溯为 chars 找一条相邻路径，字可复用已放置的同字格子 */
function findPath(
  grid: (string | null)[][],
  chars: string[],
  size: number,
): CellPos[] | null {
  for (const start of shuffle(allCells(size))) {
    const visited = new Set<string>([cellKey(start)])
    const result = backtrack(grid, chars, 0, start, [start], visited)
    if (result) return result
  }
  return null
}

function backtrack(
  grid: (string | null)[][],
  chars: string[],
  idx: number,
  cell: CellPos,
  path: CellPos[],
  visited: Set<string>,
): CellPos[] | null {
  const ch = chars[idx]
  const existing = grid[cell.row][cell.col]
  if (existing !== null && existing !== ch) return null // 冲突：已有不同字
  if (idx === chars.length - 1) return path // 已放完最后一个字

  for (const [dr, dc] of shuffle(DIRS)) {
    const nb: CellPos = { row: cell.row + dr, col: cell.col + dc }
    if (!inBounds(nb, grid.length)) continue
    if (visited.has(cellKey(nb))) continue
    visited.add(cellKey(nb))
    path.push(nb)
    const r = backtrack(grid, chars, idx + 1, nb, path, visited)
    if (r) return r
    path.pop()
    visited.delete(cellKey(nb))
  }
  return null
}

function placeOnGrid(
  grid: (string | null)[][],
  chars: string[],
  path: CellPos[],
): void {
  for (let i = 0; i < chars.length; i++) {
    const { row, col } = path[i]
    if (grid[row][col] === null) grid[row][col] = chars[i]
  }
}

function fillEmpty(grid: (string | null)[][], fillers: string[]): void {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] === null) {
        grid[r][c] = fillers[Math.floor(Math.random() * fillers.length)]
      }
    }
  }
}

/** 从词库选候选词：80% 短词(2-3字) + 20% 成语(4字) */
function pickCandidates(dictionary: DictWord[], count: number): DictWord[] {
  const short = dictionary.filter((w) => w.length <= 3)
  const idioms = dictionary.filter((w) => w.length === 4)
  const idiomCount = Math.max(1, Math.round(count * 0.2))
  const picked: DictWord[] = []
  picked.push(...shuffle(short).slice(0, Math.max(0, count - idiomCount)))
  picked.push(...shuffle(idioms).slice(0, idiomCount))
  return shuffle(picked)
}

/**
 * 生成保证至少 minTarget 个目标词可连的网格
 */
export function generateGrid(
  size: number,
  dictionary: DictWord[],
  minTarget = 3,
  candidateCount = 6,
  maxRetries = 5,
): GeneratedGrid {
  for (let retry = 0; retry < maxRetries; retry++) {
    const grid = makeEmpty(size)
    const placed: string[] = []
    const candidates = pickCandidates(dictionary, candidateCount)

    for (const w of candidates) {
      if (placed.length >= candidateCount) break
      const path = findPath(grid, w.chars, size)
      if (path) {
        placeOnGrid(grid, w.chars, path)
        placed.push(w.word)
      }
    }

    if (placed.length >= minTarget) {
      fillEmpty(grid, FILLER_CHARS)
      return {
        grid: grid.map((r) => r.map((c) => c as string)),
        targetWords: placed,
        size,
      }
    }
  }

  // 兜底：放宽 minTarget 重试（递减到 1 后走最终兜底，保证终止）
  if (minTarget > 1) {
    return generateGrid(size, dictionary, minTarget - 1, candidateCount + 2, 3)
  }

  // 最终兜底：尽力放置至少 1 个词，仍失败则返回填满字的无目标网格
  const grid = makeEmpty(size)
  const placed: string[] = []
  for (const w of pickCandidates(dictionary, candidateCount + 6)) {
    const path = findPath(grid, w.chars, size)
    if (path) {
      placeOnGrid(grid, w.chars, path)
      placed.push(w.word)
      break
    }
  }
  fillEmpty(grid, FILLER_CHARS)
  return {
    grid: grid.map((r) => r.map((c) => c as string)),
    targetWords: placed,
    size,
  }
}
