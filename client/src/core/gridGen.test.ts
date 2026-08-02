import { describe, it, expect } from 'vitest'
import { generateGrid } from './gridGen'
import type { CellPos, DictWord } from './types'
import dictionary from '../data/dictionary.json'

const dict = dictionary as DictWord[]

/**
 * DFS 验证词在网格上是否存在合法 8 向相邻路径（不重复格）
 * 这是可解性的独立验证，不依赖 gridGen 内部逻辑
 */
function canFindWord(grid: string[][], word: string): boolean {
  const chars = word.split('')
  const size = grid.length
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === chars[0]) {
        if (dfs(grid, chars, 0, { row: r, col: c }, new Set([`${r},${c}`]))) {
          return true
        }
      }
    }
  }
  return false
}

function dfs(
  grid: string[][],
  chars: string[],
  idx: number,
  cell: CellPos,
  visited: Set<string>,
): boolean {
  if (grid[cell.row][cell.col] !== chars[idx]) return false
  if (idx === chars.length - 1) return true
  const size = grid.length
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const nr = cell.row + dr
      const nc = cell.col + dc
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue
      const k = `${nr},${nc}`
      if (visited.has(k)) continue
      visited.add(k)
      if (dfs(grid, chars, idx + 1, { row: nr, col: nc }, visited)) return true
      visited.delete(k)
    }
  }
  return false
}

describe('generateGrid', () => {
  it('生成 5x5 网格', () => {
    const g = generateGrid(5, dict)
    expect(g.size).toBe(5)
    expect(g.grid).toHaveLength(5)
    expect(g.grid[0]).toHaveLength(5)
  })

  it('网格无空格且均为单字字符串', () => {
    const g = generateGrid(5, dict)
    for (const row of g.grid) {
      for (const cell of row) {
        expect(typeof cell).toBe('string')
        expect(cell.length).toBe(1)
      }
    }
  })

  it('至少 3 个目标词', () => {
    const g = generateGrid(5, dict)
    expect(g.targetWords.length).toBeGreaterThanOrEqual(3)
  })

  it('每个目标词在网格上确实可连（核心可解性，跑10次）', () => {
    for (let i = 0; i < 10; i++) {
      const g = generateGrid(5, dict)
      expect(g.targetWords.length).toBeGreaterThanOrEqual(3)
      for (const w of g.targetWords) {
        expect(canFindWord(g.grid, w)).toBe(true)
      }
    }
  })

  it('多次生成结果有随机性', () => {
    const g1 = generateGrid(5, dict)
    const g2 = generateGrid(5, dict)
    expect(JSON.stringify(g1.grid)).not.toEqual(JSON.stringify(g2.grid))
  })

  it('4x4 网格也能生成且可解', () => {
    const g = generateGrid(4, dict)
    expect(g.size).toBe(4)
    expect(g.targetWords.length).toBeGreaterThanOrEqual(2)
    for (const w of g.targetWords) {
      expect(canFindWord(g.grid, w)).toBe(true)
    }
  })
})
