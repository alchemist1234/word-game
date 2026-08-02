/** 稀有度（对齐 GDD §2.4.2） */
export type Rarity = 'common' | 'normal' | 'rare' | 'idiom'

/** 词库条目（对齐 GDD §3.1.1） */
export interface DictWord {
  word: string
  length: number
  frequency: number
  rarity: Rarity
  chars: string[]
  meaning?: string
}

/** 格子坐标 */
export interface CellPos {
  row: number
  col: number
}

/** 网格生成结果（含潜在词池，对齐迭代2详细设计） */
export interface GeneratedGrid {
  grid: string[][]
  targetWords: string[]
  potentialCount: number
  potentialWords: string[]
  size: number
}

/** 难度配置（对齐 GDD §3.2.3） */
export interface DifficultyConfig {
  size: number
  minTarget: number
  candidateCount: number
  idiomRatio: number
  potentialMin: number
  potentialMax: number
}

export const DIFFICULTIES: Record<string, DifficultyConfig> = {
  easy: { size: 4, minTarget: 5, candidateCount: 7, idiomRatio: 0.1, potentialMin: 15, potentialMax: 25 },
  standard: { size: 5, minTarget: 8, candidateCount: 12, idiomRatio: 0.25, potentialMin: 30, potentialMax: 50 },
  hard: { size: 6, minTarget: 14, candidateCount: 20, idiomRatio: 0.4, potentialMin: 60, potentialMax: 100 },
}
