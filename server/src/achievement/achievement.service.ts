import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import { UserAchievementEntity } from './user-achievement.entity'
import { UserFoundWordEntity } from '../user/user-found-word.entity'
import { UserEntity } from '../user/user.entity'
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
    @InjectDataSource() private readonly dataSource: DataSource,
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
    progress: number
    unlockedAt?: Date
  }>> {
    const rows = await this.repo.find({ where: { userId } })
    const map = new Map(rows.map((r) => [r.achievementId, r]))
    const user = await this.userRepo.findOne({ where: { id: userId } })
    const collected = await this.foundRepo.count({ where: { userId } })
    return ACHIEVEMENTS.map((a) => {
      const r = map.get(a.id)
      let progress = r ? 1 : 0
      if (!r && a.trigger === 'pokedex') {
        progress = Math.min(1, collected / Math.max(1, Number(a.condition.collected ?? 1)))
      } else if (!r && a.trigger === 'rank' && user) {
        progress = Math.min(1, user.rankTier / Math.max(1, Number(a.condition.tier ?? 1)))
      }
      return {
        id: a.id,
        name: a.name,
        desc: a.desc,
        trigger: a.trigger,
        unlocked: !!r,
        claimed: r?.claimed ?? false,
        progress: Math.round(progress * 100) / 100,
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
        try {
          await this.dataSource.transaction(async (manager) => {
            const existing = await manager.findOne(UserAchievementEntity, {
              where: { userId, achievementId: ach.id },
            })
            if (existing) return
            const entity = manager.create(UserAchievementEntity, {
              userId,
              achievementId: ach.id,
              claimed: true,
            })
            await manager.save(entity)
            if (ach.reward.coins) {
              await manager.increment(UserEntity, { id: userId }, 'coins', ach.reward.coins)
            }
            if (ach.reward.diamonds) {
              await manager.increment(
                UserEntity,
                { id: userId },
                'diamonds',
                ach.reward.diamonds,
              )
            }
          })
          this.logger.log(`Achievement unlocked: user ${userId} -> ${ach.id}`)
        } catch (error) {
          // 唯一键竞争表示另一请求已完成；其他错误继续向上抛出以支持补偿重试。
          const raced = await this.repo.findOne({
            where: { userId, achievementId: ach.id },
          })
          if (!raced) throw error
        }
      }
    }
  }

  async claim(userId: number, achievementId: string): Promise<{ ok: boolean }> {
    await this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(UserAchievementEntity, {
        where: { userId, achievementId },
      })
      if (!row) throw new Error('成就未解锁')
      if (row.claimed) return
      const claimed = await manager.update(
        UserAchievementEntity,
        { userId, achievementId, claimed: false },
        { claimed: true },
      )
      if (claimed.affected === 0) return
      const cfg = ACHIEVEMENTS.find((a) => a.id === achievementId)
      if (cfg?.reward.coins) {
        await manager.increment(UserEntity, { id: userId }, 'coins', cfg.reward.coins)
      }
      if (cfg?.reward.diamonds) {
        await manager.increment(
          UserEntity,
          { id: userId },
          'diamonds',
          cfg.reward.diamonds,
        )
      }
    })
    return { ok: true }
  }
}
