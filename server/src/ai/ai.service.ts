import { Injectable, Logger } from '@nestjs/common'
import levels from '../../data/ai-levels.json'

export interface AiLevelConfig {
  level: string
  minLen: number
  maxLen: number
  rarities: string[]
  sort: 'random' | 'idiomFirst' | 'scoreDesc'
  intervalMinMs: number
  intervalMaxMs: number
  missRate?: number
  missRateByRarity?: Record<string, number>
}

const SCORE_MAP: Record<number, number> = { 2: 2, 3: 5, 4: 10, 5: 20, 6: 35 }
const RARITY_MULT: Record<string, number> = { common: 1.0, normal: 1.3, rare: 1.8, idiom: 2.5 }

function calcScoreForAi(length: number, rarity: string): number {
  const base = SCORE_MAP[length] ?? 35
  return Math.round(base * (RARITY_MULT[rarity] ?? 1))
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)
  private readonly map = new Map<string, AiLevelConfig>()

  constructor() {
    for (const l of levels as AiLevelConfig[]) this.map.set(l.level, l)
  }

  getConfig(level: string): AiLevelConfig {
    return this.map.get(level) ?? this.map.get('L3')!
  }

  levelForAvgTier(avgTier: number): string {
    if (avgTier >= 5) return 'L5'
    if (avgTier >= 4) return 'L4'
    if (avgTier >= 3) return 'L3'
    if (avgTier <= 2) return 'L2'
    return 'L3'
  }

  buildCandidatePool(
    potentialWithRarity: Array<{ word: string; rarity: string; length: number }>,
    level: string,
  ): Array<{ word: string; rarity: string; length: number; score: number }> {
    const cfg = this.getConfig(level)
    let pool = potentialWithRarity.filter(
      (p) => p.length >= cfg.minLen && p.length <= cfg.maxLen && cfg.rarities.includes(p.rarity),
    )
    if (pool.length === 0) pool = [...potentialWithRarity]
    const withScore = pool.map((p) => ({ ...p, score: calcScoreForAi(p.length, p.rarity) }))
    if (cfg.sort === 'random') {
      for (let i = withScore.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[withScore[i], withScore[j]] = [withScore[j], withScore[i]]
      }
    } else if (cfg.sort === 'idiomFirst') {
      const order: Record<string, number> = { idiom: 0, rare: 1, normal: 2, common: 3 }
      withScore.sort((a, b) => {
        if (a.rarity !== b.rarity) return (order[a.rarity] ?? 9) - (order[b.rarity] ?? 9)
        return b.score - a.score
      })
    } else {
      withScore.sort((a, b) => b.score - a.score)
    }
    return withScore
  }

  randomInterval(level: string): number {
    const cfg = this.getConfig(level)
    return cfg.intervalMinMs + Math.floor(Math.random() * (cfg.intervalMaxMs - cfg.intervalMinMs))
  }

  shouldMiss(level: string, rarity?: string, elapsedSec?: number): boolean {
    const cfg = this.getConfig(level)
    let base = cfg.missRate ?? 0
    if (cfg.missRateByRarity && rarity) {
      base = cfg.missRateByRarity[rarity] ?? base
    }
    if (elapsedSec !== undefined && elapsedSec >= 0) {
      const k = 0.5
      const cap = 0.95
      const progress = Math.min(1, elapsedSec / 180)
      const dynamic = base + (1 - base) * k * progress
      base = Math.min(cap, dynamic)
    }
    return Math.random() < base
  }
}
