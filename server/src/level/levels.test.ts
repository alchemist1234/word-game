import { describe, it, expect } from '@jest/globals'
import levelsConfig from './levels.json'

interface LevelConfigForTest {
  id: string
  chapter: number
  level: number
  title: string
  size: number
  difficulty: string
  objective: { type: string; target?: number; score?: number; char?: string }
  stars: number[]
  duration: number
  boss?: boolean
}

const LEVELS = levelsConfig as LevelConfigForTest[]

function findLevel(id: string): LevelConfigForTest | undefined {
  return LEVELS.find((l) => l.id === id)
}

describe('levels.json config', () => {
  it('LEVELS 包含恰好 6 个章节 {1,2,3,4,5,6}', () => {
    const chapters = new Set(LEVELS.map((l) => l.chapter))
    expect(chapters.size).toBe(6)
    for (const ch of [1, 2, 3, 4, 5, 6]) {
      expect(chapters.has(ch)).toBe(true)
    }
  })

  it('每个章节恰好 5 关', () => {
    for (let ch = 1; ch <= 6; ch++) {
      const levels = LEVELS.filter((l) => l.chapter === ch)
      expect(levels).toHaveLength(5)
      const lvls = new Set(levels.map((l) => l.level))
      expect(lvls.size).toBe(5)
    }
  })

  it('每个章节的 level=5 标记 boss=true', () => {
    for (let ch = 1; ch <= 6; ch++) {
      const boss = LEVELS.find((l) => l.chapter === ch && l.level === 5)
      expect(boss).toBeDefined()
      expect(boss?.boss).toBe(true)
    }
  })

  it('第 6 章关卡 size=6（6x6 高难）', () => {
    const ch6 = LEVELS.filter((l) => l.chapter === 6)
    expect(ch6.length).toBe(5)
    for (const l of ch6) {
      expect(l.size).toBe(6)
    }
  })

  it('1-5: specificWord 大 target=3', () => {
    const lv = findLevel('1-5')
    expect(lv).toBeDefined()
    expect(lv?.objective.type).toBe('specificWord')
    expect(lv?.objective.char).toBe('大')
    expect(lv?.objective.target).toBe(3)
  })

  it('4-5: score target=70', () => {
    const lv = findLevel('4-5')
    expect(lv).toBeDefined()
    expect(lv?.objective.type).toBe('score')
    expect(lv?.objective.target).toBe(70)
  })

  it('5-5: idiom target=5', () => {
    const lv = findLevel('5-5')
    expect(lv).toBeDefined()
    expect(lv?.objective.type).toBe('idiom')
    expect(lv?.objective.target).toBe(5)
  })

  it('6-5: score target=100', () => {
    const lv = findLevel('6-5')
    expect(lv).toBeDefined()
    expect(lv?.objective.type).toBe('score')
    expect(lv?.objective.target).toBe(100)
  })
})
