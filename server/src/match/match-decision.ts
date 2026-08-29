/**
 * 对战胜负判定纯逻辑（GDD §4.2.2，独立可单测，不依赖 Nest 运行时）
 * 对齐项目 check.ts 纯逻辑模式
 */

export interface PlayerStats {
  score: number
  rareCount: number
  maxCombo: number
  foundWords: Array<{ word: string; score: number; rarity: string }>
}

/**
 * 胜负判定：分数 → 稀有词数 → 连击峰值
 * 返回 1 = A 胜 / 2 = B 胜 / 0 = 平
 */
export function decideWinner(a: PlayerStats, b: PlayerStats): 0 | 1 | 2 {
  if (a.score !== b.score) return a.score > b.score ? 1 : 2
  if (a.rareCount !== b.rareCount) return a.rareCount > b.rareCount ? 1 : 2
  if (a.maxCombo !== b.maxCombo) return a.maxCombo > b.maxCombo ? 1 : 2
  return 0
}
