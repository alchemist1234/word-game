import { decideWinner } from './match-decision'

interface Stats {
  score: number
  rareCount: number
  maxCombo: number
  foundWords: Array<{ word: string; score: number; rarity: string }>
}

const stats = (score: number, rareCount = 0, maxCombo = 0): Stats => ({
  score,
  rareCount,
  maxCombo,
  foundWords: [],
})

describe('decideWinner（GDD §4.2.2：分数 → 稀有词数 → 连击峰值）', () => {
  it('分数高者胜', () => {
    expect(decideWinner(stats(120), stats(100))).toBe(1)
    expect(decideWinner(stats(80), stats(95))).toBe(2)
  })

  it('同分看稀有词数', () => {
    expect(decideWinner(stats(100, 3), stats(100, 1))).toBe(1)
    expect(decideWinner(stats(100, 1), stats(100, 4))).toBe(2)
  })

  it('同分同稀有词数看连击峰值', () => {
    expect(decideWinner(stats(100, 2, 8), stats(100, 2, 5))).toBe(1)
    expect(decideWinner(stats(100, 2, 3), stats(100, 2, 9))).toBe(2)
  })

  it('全部相同为平局', () => {
    expect(decideWinner(stats(100, 2, 6), stats(100, 2, 6))).toBe(0)
    expect(decideWinner(stats(0), stats(0))).toBe(0)
  })
})
