import type { DictWord, Rarity } from './types'

/** 字数基础分（对齐 GDD §2.4.1） */
const BASE_SCORE: Record<number, number> = {
  2: 2,
  3: 5,
  4: 10,
  5: 20,
  6: 35,
}

/** 稀有度系数（对齐 GDD §2.4.2） */
const RARITY_MULT: Record<Rarity, number> = {
  common: 1.0,
  normal: 1.3,
  rare: 1.8,
  idiom: 2.5,
}

/**
 * 计算单个词得分（本迭代无连击）
 * 公式：字数基础分 × 稀有度系数，四舍五入取整
 */
export function calcScore(dw: DictWord): number {
  const base = BASE_SCORE[dw.length] ?? 35
  return Math.round(base * RARITY_MULT[dw.rarity])
}

/** 供外部使用的系数表（store 计算连击时可能需要） */
export { BASE_SCORE, RARITY_MULT }
