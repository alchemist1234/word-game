import { describe, it, expect } from '@jest/globals'
import { calcScore, calcComboMultiplier, isAdjacent, validatePath, hasDuplicateCell } from './check'
import type { CellPos, Rarity } from '../grid-gen/types'

// 对齐 GDD §2.4.4 计分用例
describe('calcScore', () => {
  it('2字常见 = 2', () => {
    expect(calcScore(2, 'common')).toBe(2)
  })
  it('2字一般 = 3 (round 2*1.3)', () => {
    expect(calcScore(2, 'normal')).toBe(3)
  })
  it('3字一般 = 7 (round 5*1.3)', () => {
    expect(calcScore(3, 'normal')).toBe(7)
  })
  it('2字罕见 = 4 (round 2*1.8)', () => {
    expect(calcScore(2, 'rare')).toBe(4)
  })
  it('4字成语 = 25 (round 10*2.5)', () => {
    expect(calcScore(4, 'idiom')).toBe(25)
  })
  it('5字一般 = 26 (round 20*1.3)', () => {
    expect(calcScore(5, 'normal')).toBe(26)
  })
})

// 对齐 GDD §2.4.4 连击计分用例
describe('calcScore with combo', () => {
  it('朋友（第1词 combo=0）系数1.0 = 2', () => {
    expect(calcScore(2, 'common', calcComboMultiplier(0))).toBe(2)
  })
  it('犹豫（第2词 combo=1）系数1.1 = 3 (round 2*1.3*1.1)', () => {
    expect(calcScore(2, 'normal', calcComboMultiplier(1))).toBe(3)
  })
  it('春暖花开（第3词 combo=2）系数1.2 = 30', () => {
    expect(calcScore(4, 'idiom', calcComboMultiplier(2))).toBe(30)
  })
  it('守望相助（第4词 combo=3）系数1.3 = 33 (round 10*2.5*1.3)', () => {
    expect(calcScore(4, 'idiom', calcComboMultiplier(3))).toBe(33)
  })
  it('combo 封顶 10 系数 = 2.0', () => {
    expect(calcComboMultiplier(10)).toBe(2)
    expect(calcComboMultiplier(15)).toBe(2)
  })
  it('combo=7 系数精确为 1.7（无浮点误差）', () => {
    expect(calcComboMultiplier(7)).toBe(1.7)
  })
})

describe('isAdjacent', () => {
  it('水平相邻', () => {
    expect(isAdjacent({ row: 0, col: 0 }, { row: 0, col: 1 })).toBe(true)
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

describe('hasDuplicateCell', () => {
  it('无重复', () => {
    expect(hasDuplicateCell([{ row: 0, col: 0 }, { row: 0, col: 1 }])).toBe(false)
  })
  it('有重复', () => {
    expect(hasDuplicateCell([{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 0 }])).toBe(true)
  })
})

describe('validatePath', () => {
  it('合法路径', () => {
    const cells: CellPos[] = [{ row: 0, col: 0 }, { row: 0, col: 1 }]
    expect(validatePath(cells)).toEqual({ valid: true })
  })
  it('单字路径无效', () => {
    expect(validatePath([{ row: 0, col: 0 }])).toEqual({
      valid: false,
      reason: 'path_invalid',
    })
  })
  it('不相邻无效', () => {
    const cells: CellPos[] = [{ row: 0, col: 0 }, { row: 2, col: 2 }]
    expect(validatePath(cells).valid).toBe(false)
  })
  it('重复格无效', () => {
    const cells: CellPos[] = [
      { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 0 },
    ]
    expect(validatePath(cells).valid).toBe(false)
  })
  it('成语长度路径合法', () => {
    const cells: CellPos[] = [
      { row: 0, col: 0 }, { row: 0, col: 1 },
      { row: 0, col: 2 }, { row: 0, col: 3 },
    ]
    expect(validatePath(cells).valid).toBe(true)
  })
})
