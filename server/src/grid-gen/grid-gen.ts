import type { CellPos, DictWord, GeneratedGrid } from './types'
import { DIFFICULTIES } from './types'
import type { Trie } from './trie'
import { computePotential } from './potential'

/**
 * 网格生成器（迁移自迭代1 gridGen.ts，增强：难度配置 + 潜在词池）
 * 对齐迭代2详细设计 §5.3 / GDD §3.2.2
 *
 * 原 Go grid-service 的工作，按"装Docker Go并入Nest.js"决策改用 TS 实现。
 */

/** 高频填充字池 */
const FILLER_CHARS = [
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

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
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

function findPath(grid: (string | null)[][], chars: string[], size: number): CellPos[] | null {
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
  if (existing !== null && existing !== ch) return null
  if (idx === chars.length - 1) return path

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

function placeOnGrid(grid: (string | null)[][], chars: string[], path: CellPos[]): void {
  for (let i = 0; i < chars.length; i++) {
    const { row, col } = path[i]
    if (grid[row][col] === null) grid[row][col] = chars[i]
  }
}

function fillEmpty(grid: (string | null)[][]): void {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] === null) {
        grid[r][c] = FILLER_CHARS[Math.floor(Math.random() * FILLER_CHARS.length)]
      }
    }
  }
}

/** 按难度选候选词：idiomRatio 控制成语占比 */
function pickCandidates(dictionary: DictWord[], count: number, idiomRatio: number): DictWord[] {
  const short = dictionary.filter((w) => w.length <= 3)
  const idioms = dictionary.filter((w) => w.length === 4)
  const idiomCount = Math.max(1, Math.round(count * idiomRatio))
  const picked: DictWord[] = []
  picked.push(...shuffle(short).slice(0, Math.max(0, count - idiomCount)))
  picked.push(...shuffle(idioms).slice(0, idiomCount))
  return shuffle(picked)
}

/**
 * 单轮生成：保证至少 minTarget 个目标词可连，返回 GeneratedGrid（含潜在词池）
 * 失败（目标词未放满）返回 null
 */
function tryGenerateOnce(
  size: number,
  minTarget: number,
  candidateCount: number,
  idiomRatio: number,
  dictionary: DictWord[],
  trie: Trie,
): GeneratedGrid | null {
  const grid = makeEmpty(size)
  const placed: string[] = []
  const candidates = pickCandidates(dictionary, candidateCount, idiomRatio)

  for (const w of candidates) {
    if (placed.length >= candidateCount) break
    const path = findPath(grid, w.chars, size)
    if (path) {
      placeOnGrid(grid, w.chars, path)
      placed.push(w.word)
    }
  }

  if (placed.length < minTarget) return null
  fillEmpty(grid)
  const potentialWords = computePotential(
    grid.map((r) => r.map((c) => c as string)),
    trie,
  )
  return {
    grid: grid.map((r) => r.map((c) => c as string)),
    targetWords: placed,
    potentialCount: potentialWords.length,
    potentialWords,
    size,
  }
}

/**
 * 生成网格并做难度校准（技术债 #5 部分）：
 * 多轮生成，选潜在词池落入 [potentialMin, potentialMax] 区间的网格；
 * 都不落则选最接近区间中值的。填充字组合优化留迭代5。
 */
export function generateGrid(
  difficulty: string,
  dictionary: DictWord[],
  trie: Trie,
  maxRounds = 15,
): GeneratedGrid {
  const cfg = DIFFICULTIES[difficulty] ?? DIFFICULTIES.standard
  const { size, minTarget, candidateCount, idiomRatio, potentialMin, potentialMax } =
    cfg
  const mid = (potentialMin + potentialMax) / 2

  let best: GeneratedGrid | null = null
  let bestDist = Infinity

  for (let round = 0; round < maxRounds; round++) {
    const g = tryGenerateOnce(
      size,
      minTarget,
      candidateCount,
      idiomRatio,
      dictionary,
      trie,
    )
    if (!g) continue
    if (g.potentialCount >= potentialMin && g.potentialCount <= potentialMax) {
      return g // 命中区间，直接返回
    }
    const dist = Math.abs(g.potentialCount - mid)
    if (dist < bestDist) {
      bestDist = dist
      best = g
    }
  }

  if (best) return best

  // 兜底：放宽 minTarget 再来一轮
  const relaxed = tryGenerateOnce(
    size,
    Math.max(1, minTarget - 1),
    candidateCount + 4,
    idiomRatio,
    dictionary,
    trie,
  )
  if (relaxed) return relaxed

  // 极兜底：填满字的网格（targetWords 可能为空，极少发生）
  const grid = makeEmpty(size)
  fillEmpty(grid)
  const potentialWords = computePotential(
    grid.map((r) => r.map((c) => c as string)),
    trie,
  )
  return {
    grid: grid.map((r) => r.map((c) => c as string)),
    targetWords: [],
    potentialCount: potentialWords.length,
    potentialWords,
    size,
  }
}
