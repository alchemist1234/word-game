import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { UserAchievementEntity } from './user-achievement.entity'
import { UserFoundWordEntity } from '../user/user-found-word.entity'
import { UserEntity } from '../user/user.entity'
import { EconomyService } from '../economy/economy.service'
import achievementsJson from '../../data/achievements.json'

interface AchievementConfig {
  id: string
  name: string
  desc: string
  trigger: string
  condition: Record<string, unknown>
  reward: { coins?: number; diamonds?: number }
}

const ACHIEVEMENTS = achievementsJson as AchievementConfig[]

@Injectable()
export class AchievementService {
  private readonly logger = new Logger(AchievementService.name)

  constructor(
    @InjectRepository(UserAchievementEntity) private readonly repo: Repository<UserAchievementEntity>,
    @InjectRepository(UserFoundWordEntity) private readonly foundRepo: Repository<UserFoundWordEntity>,
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    private readonly economyService: EconomyService,
  ) {}

  getConfig(): AchievementConfig[] {
    return ACHIEVEMENTS
  }

  async list(userId: number): Promise<Array<{
    id: string
    name: string
    desc: string
    trigger: string
    unlocked: boolean
    claimed: boolean
    unlockedAt?: Date
  }>> {
    const rows = await this.repo.find({ where: { userId } })
    const map = new Map(rows.map((r) => [r.achievementId, r]))
    return ACHIEVEMENTS.map((a) => {
      const r = map.get(a.id)
      return {
        id: a.id,
        name: a.name,
        desc: a.desc,
        trigger: a.trigger,
        unlocked: !!r,
        claimed: r?.claimed ?? false,
        unlockedAt: r?.unlockedAt,
      }
    })
  }

  async check(
    userId: number,
    event: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    for (const ach of ACHIEVEMENTS) {
      if (ach.trigger !== event) continue
      const already = await this.repo.findOne({ where: { userId, achievementId: ach.id } })
      if (already) continue
      let met = false
      const c = ach.condition
      switch (event) {
        case 'level_complete':
          met = payload.levelId === c.level
          break
        case 'word_found':
          met = payload.rarity === c.rarity
          break
        case 'maxCombo':
          met = (payload.maxCombo as number) >= (c.minCombo as number)
          break
        case 'pokedex': {
          const collected = await this.foundRepo.count({ where: { userId } })
          met = collected >= (c.collected as number)
          break
        }
        case 'rank': {
          const user = await this.userRepo.findOne({ where: { id: userId } })
          met = !!user && user.rankTier >= (c.tier as number)
          break
        }
        case 'daily':
          met = (payload.count as number) >= (c.count as number)
          break
        case 'match_4p':
          met = payload.rank === c.rank
          break
        case 'challenge':
          met = (payload.count as number) >= (c.count as number)
          break
        default:
          met = false
      }
      if (met) {
        const entity = this.repo.create({ userId, achievementId: ach.id, claimed: true })
        await this.repo.save(entity)
        if (ach.reward.coins) await this.economyService.addCoins(userId, ach.reward.coins)
        if (ach.reward.diamonds) await this.economyService.addDiamonds(userId, ach.reward.diamonds)
        this.logger.log(`Achievement unlocked: user ${userId} -> ${ach.id}`)
      }
    }
  }

  async claim(userId: number, achievementId: string): Promise<{ ok: boolean }> {
    const row = await this.repo.findOne({ where: { userId, achievementId } })
    if (!row) throw new Error('成就未解锁')
    if (row.claimed) return { ok: true }
    row.claimed = true
    await this.repo.save(row)
    const cfg = ACHIEVEMENTS.find((a) => a.id === achievementId)
    if (cfg?.reward.coins) await this.economyService.addCoins(userId, cfg.reward.coins)
    if (cfg?.reward.diamonds) await this.economyService.addDiamonds(userId, cfg.reward.diamonds)
    return { ok: true }
  }
}
