import { describe, it, expect, beforeAll } from '@jest/globals'
import { generateGrid } from './grid-gen'
import { Trie } from './trie'
import { computePotential } from './potential'
import type { CellPos, DictWord } from './types'

// 测试用小词库（验证逻辑，不依赖真实 5000 词库）
const testDict: DictWord[] = [
  { word: '中国', length: 2, frequency: 0.9, rarity: 'common', chars: ['中', '国'] },
  { word: '朋友', length: 2, frequency: 0.85, rarity: 'common', chars: ['朋', '友'] },
  { word: '时间', length: 2, frequency: 0.88, rarity: 'common', chars: ['时', '间'] },
  { word: '快乐', length: 2, frequency: 0.82, rarity: 'common', chars: ['快', '乐'] },
  { word: '今天', length: 2, frequency: 0.8, rarity: 'common', chars: ['今', '天'] },
  { word: '我们', length: 2, frequency: 0.92, rarity: 'common', chars: ['我', '们'] },
  { word: '生活', length: 2, frequency: 0.78, rarity: 'common', chars: ['生', '活'] },
  { word: '工作', length: 2, frequency: 0.75, rarity: 'common', chars: ['工', '作'] },
  { word: '学习', length: 2, frequency: 0.72, rarity: 'common', chars: ['学', '习'] },
  { word: '世界', length: 2, frequency: 0.7, rarity: 'common', chars: ['世', '界'] },
  { word: '国家', length: 2, frequency: 0.68, rarity: 'common', chars: ['国', '家'] },
  { word: '文化', length: 2, frequency: 0.5, rarity: 'common', chars: ['文', '化'] },
  { word: '犹豫', length: 2, frequency: 0.3, rarity: 'normal', chars: ['犹', '豫'] },
  { word: '漫步', length: 2, frequency: 0.25, rarity: 'normal', chars: ['漫', '步'] },
  { word: '宁静', length: 2, frequency: 0.2, rarity: 'normal', chars: ['宁', '静'] },
  { word: '自来水', length: 3, frequency: 0.4, rarity: 'common', chars: ['自', '来', '水'] },
  { word: '说明书', length: 3, frequency: 0.35, rarity: 'common', chars: ['说', '明', '书'] },
  { word: '计算机', length: 3, frequency: 0.45, rarity: 'common', chars: ['计', '算', '机'] },
  { word: '图书馆', length: 3, frequency: 0.3, rarity: 'common', chars: ['图', '书', '馆'] },
  { word: '春暖花开', length: 4, frequency: 0.08, rarity: 'idiom', chars: ['春', '暖', '花', '开'] },
  { word: '画蛇添足', length: 4, frequency: 0.07, rarity: 'idiom', chars: ['画', '蛇', '添', '足'] },
  { word: '守株待兔', length: 4, frequency: 0.06, rarity: 'idiom', chars: ['守', '株', '待', '兔'] },
  { word: '亡羊补牢', length: 4, frequency: 0.07, rarity: 'idiom', chars: ['亡', '羊', '补', '牢'] },
  { word: '山清水秀', length: 4, frequency: 0.05, rarity: 'idiom', chars: ['山', '清', '水', '秀'] },
]

let trie: Trie
beforeAll(() => {
  trie = new Trie()
  for (const w of testDict) trie.insert(w.word)
})

/** 独立 DFS 验证词在网格上可连（不依赖生成器内部） */
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

function dfs(grid: string[][], chars: string[], idx: number, cell: CellPos, visited: Set<string>): boolean {
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
  it('生成 5x5 网格（standard）', () => {
    const g = generateGrid('standard', testDict, trie)
    expect(g.size).toBe(5)
    expect(g.grid).toHaveLength(5)
    expect(g.grid[0]).toHaveLength(5)
  })

  it('网格无空格且均为单字', () => {
    const g = generateGrid('standard', testDict, trie)
    for (const row of g.grid) {
      for (const cell of row) {
        expect(typeof cell).toBe('string')
        expect(cell.length).toBe(1)
      }
    }
  })

  it('每个目标词在网格上确实可连（核心可解性，跑10次）', () => {
    for (let i = 0; i < 10; i++) {
      const g = generateGrid('standard', testDict, trie)
      expect(g.targetWords.length).toBeGreaterThanOrEqual(3)
      for (const w of g.targetWords) {
        expect(canFindWord(g.grid, w)).toBe(true)
      }
    }
  })

  it('潜在词池包含所有目标词', () => {
    const g = generateGrid('standard', testDict, trie)
    for (const w of g.targetWords) {
      expect(g.potentialWords).toContain(w)
    }
  })

  it('潜在词池数 >= 目标词数', () => {
    const g = generateGrid('standard', testDict, trie)
    expect(g.potentialCount).toBeGreaterThanOrEqual(g.targetWords.length)
  })

  it('potentialCount 与 potentialWords 长度一致', () => {
    const g = generateGrid('standard', testDict, trie)
    expect(g.potentialCount).toBe(g.potentialWords.length)
  })

  it('多次生成有随机性', () => {
    const g1 = generateGrid('standard', testDict, trie)
    const g2 = generateGrid('standard', testDict, trie)
    expect(JSON.stringify(g1.grid)).not.toEqual(JSON.stringify(g2.grid))
  })

  it('easy(4x4) 也能生成且可解', () => {
    const g = generateGrid('easy', testDict, trie)
    expect(g.size).toBe(4)
    for (const w of g.targetWords) {
      expect(canFindWord(g.grid, w)).toBe(true)
    }
  })
})

describe('computePotential', () => {
  it('对已知网格正确枚举潜在词', () => {
    // 简单 2x2 网格：中 国 朋 友 -> 可成"中国""朋友"
    const grid = [['中', '国'], ['朋', '友']]
    const words = computePotential(grid, trie)
    expect(words).toContain('中国')
    expect(words).toContain('朋友')
  })
})
