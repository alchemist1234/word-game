import { calcRankDelta, recalcTier } from './rank.service'

describe('rank rules', () => {
  it('supports the seven display tiers and season percentiles', () => {
    expect(recalcTier(0)).toBe(1)
    expect(recalcTier(100)).toBe(2)
    expect(recalcTier(300)).toBe(3)
    expect(recalcTier(600)).toBe(4)
    expect(recalcTier(1000)).toBe(5)
    expect(recalcTier(1000, 0.01)).toBe(7)
    expect(recalcTier(1000, 0.1)).toBe(6)
  })

  it('keeps ranked delta boundaries explicit', () => {
    expect(calcRankDelta(1, 1, 'win')).toBe(20)
    expect(calcRankDelta(1, 7, 'win')).toBe(32)
    expect(calcRankDelta(1, 1, 'lose')).toBe(-10)
    expect(calcRankDelta(1, 1, 'draw')).toBe(5)
  })
})
