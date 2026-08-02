import { describe, it, expect } from 'vitest'
import { calcScore } from './score'
import type { DictWord, Rarity } from './types'

function makeWord(word: string, length: number, rarity: Rarity): DictWord {
  return { word, length, rarity, chars: word.split('') }
}

// 对齐 GDD §2.4.4 计分用例（本迭代无连击）
describe('calcScore', () => {
  it('2字常见 = 2 (2 × 1.0)', () => {
    expect(calcScore(makeWord('朋友', 2, 'common'))).toBe(2)
  })

  it('2字一般 = 3 (round 2 × 1.3)', () => {
    expect(calcScore(makeWord('犹豫', 2, 'normal'))).toBe(3)
  })

  it('3字一般 = 7 (round 5 × 1.3)', () => {
    expect(calcScore(makeWord('望远镜', 3, 'normal'))).toBe(7)
  })

  it('2字罕见 = 4 (round 2 × 1.8)', () => {
    expect(calcScore(makeWord('氤氲', 2, 'rare'))).toBe(4)
  })

  it('4字成语 = 25 (round 10 × 2.5)', () => {
    expect(calcScore(makeWord('春暖花开', 4, 'idiom'))).toBe(25)
  })

  it('5字 = 20 (基础分)', () => {
    expect(calcScore(makeWord('欲速则不达', 5, 'normal'))).toBe(26)
  })
})
