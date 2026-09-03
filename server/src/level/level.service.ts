import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import Redis from 'ioredis'
import { GameService } from '../game/game.service'
import { UserProgressEntity } from '../user/user-progress.entity'
import { REDIS_TOKEN } from '../common/redis.module'
import { EconomyService } from '../economy/economy.service'
import { AchievementService } from '../achievement/achievement.service'
import { DictionaryService } from '../dictionary/dictionary.service'
import { generateGrid } from '../grid-gen/grid-gen'
import { v4 as uuidv4 } from 'uuid'
import { calcScore } from '../game/check'
import type { Rarity } from '../grid-gen/types'
import levelsConfig from './levels.json'

interface LevelConfig {
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

const LEVELS = levelsConfig as LevelConfig[]
const CHAPTER_TITLES: Record<number, string> = {
  1: '初识字海',
  2: '春夏秋冬',
  3: '诗词雅韵',
  4: '节气节日',
  5: '历史典故',
  6: '山川地理',
}

@Injectable()
export class LevelService {
  constructor(
    private readonly gameService: GameService,
    @InjectRepository(UserProgressEntity)
    private readonly progressRepo: Repository<UserProgressEntity>,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    private readonly economyService: EconomyService,
    private readonly achievementService: AchievementService,
    private readonly dictionaryService: DictionaryService,
  ) {}

  /** 获取章节地图 + 进度 */
  async getChapters(userId: number): Promise<{
    chapters: Array<{
      chapter: number
      title: string
      unlocked: boolean
      levels: Array<{ id: string; title: string; stars: number; unlocked: boolean }>
    }>
  }> {
    const progress = await this.progressRepo.find({ where: { userId } })
    const progressMap = new Map(progress.map((p) => [p.levelId, p]))

    const chaptersMap = new Map<number, LevelConfig[]>()
    for (const l of LEVELS) {
      if (!chaptersMap.has(l.chapter)) chaptersMap.set(l.chapter, [])
      chaptersMap.get(l.chapter)!.push(l)
    }

    const chapters = [...chaptersMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ch, levels]) => {
        const prevChapterAllCleared =
          ch === 1 ||
          (chaptersMap
            .get(ch - 1)
            ?.every((l) => (progressMap.get(l.id)?.stars ?? 0) >= 1) ??
            false)
        return {
          chapter: ch,
          title: CHAPTER_TITLES[ch] ?? `第${ch}章`,
          unlocked: prevChapterAllCleared,
          levels: levels.map((l) => ({
            id: l.id,
            title: l.title,
            stars: progressMap.get(l.id)?.stars ?? 0,
            unlocked: this.isLevelUnlocked(l, levels, progressMap),
            boss: !!l.boss,
          })),
        }
      })

    return { chapters }
  }

  private isLevelUnlocked(
    level: LevelConfig,
    levels: LevelConfig[],
    progressMap: Map<string, UserProgressEntity>,
  ): boolean {
    if (level.level === 1) return true
    const prev = levels.find((l) => l.level === level.level - 1)
    if (!prev) return true
    return (progressMap.get(prev.id)?.stars ?? 0) >= 1
  }

  /** 开始关卡：取网格 + 会话加 levelId/objective */
  async startLevel(
    userId: number,
    levelId: string,
  ): Promise<{
    matchSessionId: string
    grid: string[][]
    size: number
    duration: number
    objective: LevelConfig['objective']
    stars: number[]
    title: string
    boss: boolean
  }> {
    const cfg = LEVELS.find((l) => l.id === levelId)
    if (!cfg) throw new NotFoundException('关卡不存在')
    await this.economyService.consumeStamina(userId, 1)
    // specificWord 关保底：内存生成多张取最优，不消耗网格池（全清可3星），最多8次
    if (cfg.objective.type === 'specificWord' && cfg.objective.char) {
      const goal = cfg.objective.target ?? 0
      const [, , s3] = this.calcThresholds(goal)
      const maxAttempts = 8
      const { words, trie } = await this.dictionaryService.loadAll()
      let best: {
        grid: string[][]
        targetWords: string[]
        potentialWords: string[]
        potentialCount: number
        size: number
        count: number
      } | null = null
      for (let i = 0; i < maxAttempts; i++) {
        const g = generateGrid(cfg.difficulty, words, trie)
        const count = g.potentialWords.filter((w) => w.includes(cfg.objective.char!)).length
        if (!best || count > best.count) {
          best = { ...g, count }
        }
        if (count >= s3) break
      }
      if (best) {
        const raw = {
          id: `level-${cfg.id}-${uuidv4()}`,
          grid: best.grid,
          targetWords: best.targetWords,
          potentialWords: best.potentialWords,
          potentialCount: best.potentialCount,
          size: best.size,
        }
        const sess = await this.gameService.createSessionFromRaw(raw, userId, cfg.duration)
        await this.redis.hset(`match_session:${sess.matchSessionId}`, {
          levelId,
          objective: JSON.stringify(cfg.objective),
          isLevelMode: '1',
        })
        return {
          matchSessionId: sess.matchSessionId,
          grid: sess.grid,
          size: sess.size,
          duration: cfg.duration,
          objective: cfg.objective,
          stars: cfg.stars,
          title: cfg.title,
          boss: !!cfg.boss,
        }
      }
    }
    const gridRes = await this.gameService.getGrid(cfg.difficulty, userId, cfg.duration)
    await this.redis.hset(`match_session:${gridRes.matchSessionId}`, {
      levelId,
      objective: JSON.stringify(cfg.objective),
      isLevelMode: '1',
    })
    return {
      matchSessionId: gridRes.matchSessionId,
      grid: gridRes.grid,
      size: gridRes.size,
      duration: cfg.duration,
      objective: cfg.objective,
      stars: cfg.stars,
      title: cfg.title,
      boss: !!cfg.boss,
    }
  }

  /** 提交关卡：结算 + 星级 + 进度 */
  async submitLevel(
    userId: number,
    matchSessionId: string,
  ): Promise<{
    score: number
    comboScore: number
    maxCombo: number
    potentialCount: number
    foundWords: Array<{ word: string; score: number; rarity: string }>
    unfoundWords: Array<{ word: string; rarity: string }>
    perfect: boolean
    perfectBonus: number
    stars: number
    objectiveMet: boolean
    canNext: boolean
    nextLevelId: string | null
    newUnlocked: string[]
  }> {
    const session = await this.redis.hgetall(`match_session:${matchSessionId}`)
    if (!session?.levelId) {
      throw new BadRequestException('非闯关会话或会话已过期')
    }
    const cfg = LEVELS.find((l) => l.id === session.levelId)
    if (!cfg) throw new NotFoundException('关卡配置不存在')

    const result = await this.gameService.endGame(matchSessionId)
    const actualValue = this.calcActualValue(cfg.objective, result)
    const goal = this.calcGoalValue(cfg.objective)
    const maxAchievable = this.calcMaxAchievable(cfg.objective, session)
    const stars = this.calcStars(actualValue, goal, maxAchievable)

    if (stars >= 1) {
      await this.upsertProgress(userId, cfg.id, stars, result.score)
    }
    // 成就钩子（8b）
    try {
      await this.achievementService.check(userId, 'level_complete', { levelId: cfg.id })
      await this.achievementService.check(userId, 'maxCombo', { maxCombo: result.maxCombo })
      if (result.foundWords.some((w) => w.rarity === 'idiom')) {
        await this.achievementService.check(userId, 'word_found', { rarity: 'idiom' })
      }
      await this.achievementService.check(userId, 'pokedex', {})
    } catch {}

    // 本关是否已通关：本次 ≥1 星，或历史已 ≥1 星（0 星不写进度，历史记录即通关）
    let maxStars = stars
    if (stars < 1) {
      const history = await this.progressRepo.findOne({
        where: { userId, levelId: cfg.id },
      })
      if (history) maxStars = Math.max(maxStars, history.stars)
    }
    const canNext = maxStars >= 1

    const nextLevel = LEVELS.find(
      (l) => l.chapter === cfg.chapter && l.level === cfg.level + 1,
    )
    const nextLevelId = nextLevel ? nextLevel.id : null
    const newUnlocked: string[] = canNext && nextLevelId ? [nextLevelId] : []

    return {
      score: result.score,
      comboScore: result.comboScore,
      maxCombo: result.maxCombo,
      potentialCount: result.potentialCount,
      perfect: result.perfect,
      perfectBonus: result.perfectBonus,
      foundWords: result.foundWords,
      unfoundWords: result.unfoundWords,
      stars,
      objectiveMet: stars >= 1,
      canNext,
      nextLevelId,
      newUnlocked,
    }
  }

  private calcActualValue(
    objective: LevelConfig['objective'],
    result: { score: number; foundWords: Array<{ word: string; rarity: string }> },
  ): number {
    switch (objective.type) {
      case 'score':
        return result.score
      case 'wordCount':
        return result.foundWords.length
      case 'idiom':
        return result.foundWords.filter((w) => w.rarity === 'idiom').length
      case 'timeLimit':
        return result.score
      case 'specificWord':
        return result.foundWords.filter((w) =>
          w.word.includes(objective.char ?? ''),
        ).length
      default:
        return 0
    }
  }

  /** 星级目标值：分数/词数/成语数目标；限时关看目标分数（不看秒数） */
  private calcGoalValue(objective: LevelConfig['objective']): number {
    if (objective.type === 'timeLimit') return objective.score ?? 0
    return objective.target ?? 0
  }

  /**
   * 动态星级：1星=目标×0.5（接近完成即有星），2星=达成目标，3星=目标×1.5（超额）
   * 修复"找到接近目标却 0 星"的不合理体验
   * 全清必3星：用本局最大可达成数对阈值封顶，actual==max时必>=s3_eff
   */
  private calcThresholds(goal: number): [number, number, number] {
    const s1 = Math.max(1, Math.round(goal * 0.5))
    const s2 = Math.max(1, goal)
    const s3 = Math.max(s2 + 1, Math.round(goal * 1.5))
    return [s1, s2, s3]
  }

  private countCharInSession(session: Record<string, string>, char: string): number {
    if (!session?.potentialWords) return 0
    try {
      const potential = JSON.parse(session.potentialWords) as string[]
      return potential.filter((w) => w.includes(char)).length
    } catch {
      return 0
    }
  }

  private calcMaxAchievable(
    objective: LevelConfig['objective'],
    session: Record<string, string>,
  ): number {
    let potential: string[] = []
    try {
      potential = session?.potentialWords ? (JSON.parse(session.potentialWords) as string[]) : []
    } catch {
      potential = []
    }
    let withRarity: Array<{ word: string; rarity: string; length: number }> = []
    try {
      withRarity = session?.potentialWordsWithRarity
        ? (JSON.parse(session.potentialWordsWithRarity) as Array<{
            word: string
            rarity: string
            length: number
          }>)
        : []
    } catch {
      withRarity = []
    }
    switch (objective.type) {
      case 'specificWord':
        return potential.filter((w) => w.includes(objective.char ?? '')).length
      case 'wordCount':
        return potential.length
      case 'idiom':
        if (withRarity.length > 0) return withRarity.filter((p) => p.rarity === 'idiom').length
        return 0
      case 'score':
      case 'timeLimit':
        if (withRarity.length > 0) {
          return withRarity.reduce(
            (sum, p) => sum + calcScore(p.length, p.rarity as Rarity),
            0,
          )
        }
        return potential.length * 2
      default:
        return potential.length
    }
  }

  private calcStars(actualValue: number, goal: number, maxAchievable?: number): number {
    if (goal <= 0) return actualValue > 0 ? 1 : 0
    let [s1, s2, s3] = this.calcThresholds(goal)
    if (maxAchievable !== undefined) {
      if (maxAchievable <= 0) return 0
      s1 = Math.min(s1, maxAchievable)
      s2 = Math.min(s2, maxAchievable)
      s3 = Math.min(s3, maxAchievable)
    }
    if (actualValue >= s3) return 3
    if (actualValue >= s2) return 2
    if (actualValue >= s1) return 1
    return 0
  }

  private async upsertProgress(
    userId: number,
    levelId: string,
    stars: number,
    score: number,
  ): Promise<void> {
    const existing = await this.progressRepo.findOne({
      where: { userId, levelId },
    })
    if (existing) {
      existing.stars = Math.max(existing.stars, stars)
      existing.bestScore = Math.max(existing.bestScore, score)
      existing.completed = true
      await this.progressRepo.save(existing)
    } else {
      await this.progressRepo.save(
        this.progressRepo.create({
          userId,
          levelId,
          stars,
          bestScore: score,
          completed: true,
        }),
      )
    }
  }
}
