import { AiService } from './ai.service'

const candidates = [
  { word: '中国', rarity: 'common', length: 2 },
  { word: '朋友', rarity: 'normal', length: 2 },
  { word: '画蛇添足', rarity: 'idiom', length: 4 },
  { word: '雷打不动', rarity: 'idiom', length: 4 },
]

describe('AiService L1-L5 configuration', () => {
  afterEach(() => jest.restoreAllMocks())

  it('limits L1 to short common words', () => {
    const service = new AiService()
    const pool = service.buildCandidatePool(candidates, 'L1')
    expect(pool.length).toBeGreaterThan(0)
    expect(pool.every((item) => item.length === 2 && item.rarity === 'common')).toBe(true)
  })

  it('orders L3 idioms before lower rarity words', () => {
    const service = new AiService()
    const pool = service.buildCandidatePool(candidates, 'L3')
    expect(pool[0]?.rarity).toBe('idiom')
    expect(pool[1]?.rarity).toBe('idiom')
  })

  it('does not introduce late-game misses for L5', () => {
    const service = new AiService()
    jest.spyOn(Math, 'random').mockReturnValue(0.99)
    expect(service.shouldMiss('L5', 'idiom', 179)).toBe(false)
  })

  it('uses the documented L4 score ordering', () => {
    const service = new AiService()
    const pool = service.buildCandidatePool(candidates, 'L4')
    for (let i = 1; i < pool.length; i += 1) {
      expect(pool[i - 1].score).toBeGreaterThanOrEqual(pool[i].score)
    }
  })
})
