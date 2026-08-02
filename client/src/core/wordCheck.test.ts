import { describe, it, expect } from 'vitest'
import { checkWord, isAdjacent, type WordCheckContext } from './wordCheck'
import type { DictWord, FoundWord } from './types'
import dictionary from '../data/dictionary.json'

const dict = dictionary as DictWord[]
const wordSet = new Set(dict.map((d) => d.word))
const wordMap = new Map(dict.map((d) => [d.word, d]))

function ctx(found: string[] = []): WordCheckContext {
  const foundWords: FoundWord[] = found.map((w) => ({
    word: w,
    cells: [],
    score: 0,
    rarity: 'common',
  }))
  return { wordSet, wordMap, foundWords }
}

describe('isAdjacent', () => {
  it('水平相邻', () => {
    expect(isAdjacent({ row: 0, col: 0 }, { row: 0, col: 1 })).toBe(true)
  })
  it('垂直相邻', () => {
    expect(isAdjacent({ row: 0, col: 0 }, { row: 1, col: 0 })).toBe(true)
  })
  it('对角相邻', () => {
    expect(isAdjacent({ row: 0, col: 0 }, { row: 1, col: 1 })).toBe(true)
  })
  it('跨2格不相邻', () => {
    expect(isAdjacent({ row: 0, col: 0 }, { row: 0, col: 2 })).toBe(false)
  })
  it('同格不算相邻', () => {
    expect(isAdjacent({ row: 1, col: 1 }, { row: 1, col: 1 })).toBe(false)
  })
})

describe('checkWord', () => {
  it('合法2字词有效并计分', () => {
    const cells = [{ row: 0, col: 0 }, { row: 0, col: 1 }]
    const r = checkWord('中国', cells, ctx())
    expect(r.valid).toBe(true)
    expect(r.score).toBe(2)
    expect(r.rarity).toBe('common')
  })

  it('成语有效且高分', () => {
    const cells = [
      { row: 0, col: 0 }, { row: 0, col: 1 },
      { row: 0, col: 2 }, { row: 0, col: 3 },
    ]
    const r = checkWord('春暖花开', cells, ctx())
    expect(r.valid).toBe(true)
    expect(r.score).toBe(25)
    expect(r.rarity).toBe('idiom')
  })

  it('词不在词库 -> not_in_dict', () => {
    const cells = [{ row: 0, col: 0 }, { row: 0, col: 1 }]
    expect(checkWord('不存在', cells, ctx())).toEqual({ valid: false, reason: 'not_in_dict' })
  })

  it('路径不相邻 -> path_invalid', () => {
    const cells = [{ row: 0, col: 0 }, { row: 2, col: 2 }]
    expect(checkWord('中国', cells, ctx())).toEqual({ valid: false, reason: 'path_invalid' })
  })

  it('路径重复格 -> path_invalid', () => {
    const cells = [
      { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 0 },
    ]
    expect(checkWord('中国', cells, ctx())).toEqual({ valid: false, reason: 'path_invalid' })
  })

  it('单字路径 -> path_invalid', () => {
    expect(checkWord('中', [{ row: 0, col: 0 }], ctx())).toEqual({
      valid: false,
      reason: 'path_invalid',
    })
  })

  it('重复词 -> duplicate', () => {
    const cells = [{ row: 0, col: 0 }, { row: 0, col: 1 }]
    expect(checkWord('中国', cells, ctx(['中国']))).toEqual({
      valid: false,
      reason: 'duplicate',
    })
  })
})
