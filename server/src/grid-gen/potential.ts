import { Trie } from './trie'

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
]

/**
 * 计算网格中所有可形成的合法词（Boggle 式 DFS + Trie 剪枝）
 * 对齐迭代2详细设计 §5.4
 */
export function computePotential(grid: string[][], trie: Trie): string[] {
  const found = new Set<string>()
  const size = grid.length
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      dfs(grid, r, c, '', new Set<string>(), trie, found)
    }
  }
  return [...found]
}

function dfs(
  grid: string[][],
  r: number,
  c: number,
  prefix: string,
  visited: Set<string>,
  trie: Trie,
  found: Set<string>,
): void {
  const key = `${r},${c}`
  if (visited.has(key)) return
  const next = prefix + grid[r][c]
  if (!trie.hasPrefix(next)) return // 剪枝：前缀不在词库，停
  if (trie.hasWord(next)) found.add(next)
  visited.add(key)
  for (const [dr, dc] of DIRS) {
    const nr = r + dr
    const nc = c + dc
    if (nr >= 0 && nr < grid.length && nc >= 0 && nc < grid[0].length) {
      dfs(grid, nr, nc, next, visited, trie, found)
    }
  }
  visited.delete(key)
}
