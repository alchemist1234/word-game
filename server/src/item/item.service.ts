import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import Redis from 'ioredis'
import { REDIS_TOKEN } from '../common/redis.module'
import { UserItemEntity } from './user-item.entity'
import { UserEntity } from '../user/user.entity'
import { GridPoolService } from '../grid-pool/grid-pool.service'
import { DictionaryService } from '../dictionary/dictionary.service'
import { computePotential } from '../grid-gen/potential'
import levelsConfig from '../level/levels.json'
import itemsJson from '../../data/items.json'

export interface ItemConfig {
  id: string
  name: string
  desc: string
  costType: 'coins' | 'diamonds'
  cost: number
  maxPerLevel: number
  allowedModes: string[]
  effect: string
  params?: Record<string, unknown>
  bossOnly?: boolean
}

interface LevelCfg { id: string; boss?: boolean }

const LEVELS = levelsConfig as LevelCfg[]

@Injectable()
export class ItemService {
  private readonly items: ItemConfig[] = itemsJson as ItemConfig[]

  constructor(
    @InjectRepository(UserItemEntity) private readonly itemRepo: Repository<UserItemEntity>,
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    private readonly gridPoolService: GridPoolService,
    private readonly dictionaryService: DictionaryService,
  ) {}

  getItems(): ItemConfig[] {
    return this.items
  }

  async getInventory(userId: number): Promise<Array<{ itemId: string; quantity: number }>> {
    const rows = await this.itemRepo.find({ where: { userId } })
    const map = new Map(rows.map((r) => [r.itemId, r.quantity]))
    return this.items.map((it) => ({ itemId: it.id, quantity: map.get(it.id) ?? 0 }))
  }

  async purchase(userId: number, itemId: string, quantity = 1): Promise<{ quantity: number }> {
    const cfg = this.items.find((i) => i.id === itemId)
    if (!cfg) throw new NotFoundException('道具不存在')
    if (quantity <= 0) throw new BadRequestException('数量不合法')
    const totalCost = cfg.cost * quantity
    const user = await this.userRepo.findOne({ where: { id: userId } })
    if (!user) throw new NotFoundException('用户不存在')
    if (cfg.costType === 'coins') {
      if (user.coins < totalCost) throw new BadRequestException('金币不足')
      user.coins -= totalCost
    } else {
      if (user.diamonds < totalCost) throw new BadRequestException('钻石不足')
      user.diamonds -= totalCost
    }
    await this.userRepo.save(user)
    let inv = await this.itemRepo.findOne({ where: { userId, itemId } })
    if (!inv) {
      inv = this.itemRepo.create({ userId, itemId, quantity })
    } else {
      inv.quantity += quantity
    }
    await this.itemRepo.save(inv)
    return { quantity: inv.quantity }
  }

  private getMode(session: Record<string, string>): string {
    if (session.isLevelMode === '1') return 'level'
    if (session.isDailyMode === '1') return 'daily'
    if (session.isChallengeMode === '1') return 'friend'
    if (session.matchId) {
      // For pvp, need to distinguish 1v1 vs 4p. Without room lookup, allow both.
      // Return generic 'pvp_1v1' and let allowed check accept both via includes.
      // If session has pvpType, use it.
      if (session.pvpType === 'pvp_4p') return 'pvp_4p'
      return 'pvp_1v1'
    }
    return 'free'
  }

  private findLevelBoss(levelId: string): boolean {
    const cfg = LEVELS.find((l) => l.id === levelId)
    return !!cfg?.boss
  }

  async useItem(
    userId: number,
    matchSessionId: string,
    itemId: string,
  ): Promise<Record<string, unknown>> {
    const cfg = this.items.find((i) => i.id === itemId)
    if (!cfg) throw new NotFoundException('道具不存在')
    const session = await this.redis.hgetall(`match_session:${matchSessionId}`)
    if (!session || !session.grid) throw new NotFoundException('会话不存在或已过期')
    if (session.userId !== userId.toString()) throw new BadRequestException('会话不属于当前用户')
    const mode = this.getMode(session)
    if (!cfg.allowedModes.includes(mode)) {
      // For pvp, shuffle/double allow both 1v1 and 4p: check if mode is pvp and config allows either
      const isPvpMode = mode.startsWith('pvp')
      const allowsPvp = cfg.allowedModes.includes('pvp_1v1') || cfg.allowedModes.includes('pvp_4p')
      if (!(isPvpMode && allowsPvp)) {
        throw new BadRequestException('该道具在此模式不可用')
      }
    }
    if (cfg.bossOnly) {
      const isBoss = session.levelId ? this.findLevelBoss(session.levelId) : false
      if (!isBoss) throw new BadRequestException('该道具仅限 Boss 关使用')
    }
    // usage limit
    const usageKey = `item_usage:${matchSessionId}:${itemId}`
    const curStr = await this.redis.get(usageKey)
    const cur = curStr ? parseInt(curStr, 10) : 0
    if (cur >= cfg.maxPerLevel) throw new BadRequestException('已达本局使用上限')
    // cost: try inventory first, then coins/diamonds
    const inv = await this.itemRepo.findOne({ where: { userId, itemId } })
    let usedInventory = false
    if (inv && inv.quantity > 0) {
      inv.quantity -= 1
      await this.itemRepo.save(inv)
      usedInventory = true
    } else {
      // check balance and deduct
      const user = await this.userRepo.findOne({ where: { id: userId } })
      if (!user) throw new NotFoundException('用户不存在')
      if (cfg.costType === 'coins') {
        if (user.coins < cfg.cost) throw new BadRequestException('金币不足')
        user.coins -= cfg.cost
        await this.userRepo.save(user)
      } else {
        if (user.diamonds < cfg.cost) throw new BadRequestException('钻石不足')
        user.diamonds -= cfg.cost
        await this.userRepo.save(user)
      }
    }
    // incr usage
    await this.redis.incr(usageKey)
    await this.redis.expire(usageKey, 600)

    // effect
    const result = await this.applyEffect(cfg, session, matchSessionId, userId)
    // if effect failed, rollback cost? simplified: not rollback
    if (!usedInventory && result === null) {
      // rollback not needed
    }
    return result ?? {}
  }

  private async applyEffect(
    cfg: ItemConfig,
    session: Record<string, string>,
    matchSessionId: string,
    userId: number,
  ): Promise<Record<string, unknown>> {
    const grid = JSON.parse(session.grid) as string[][]
    const size = grid.length
    switch (cfg.effect) {
      case 'hint': {
        // find an unfound target word
        const targetWords = session.targetWords ? (JSON.parse(session.targetWords) as string[]) : []
        const foundKey = `match_session:${matchSessionId}:found`
        const foundSet = new Set(await this.redis.smembers(foundKey))
        let hintWord: string | null = null
        for (const w of targetWords) {
          if (!foundSet.has(w)) {
            hintWord = w
            break
          }
        }
        if (!hintWord) {
          // fallback: any potential not found
          const potential = session.potentialWords ? (JSON.parse(session.potentialWords) as string[]) : []
          for (const w of potential) {
            if (!foundSet.has(w)) {
              hintWord = w
              break
            }
          }
        }
        if (!hintWord) return { hintCell: null }
        const firstChar = hintWord[0]
        // find first occurrence in grid
        for (let r = 0; r < size; r++) {
          for (let c = 0; c < size; c++) {
            if (grid[r][c] === firstChar) return { hintCell: { row: r, col: c }, hintWord }
          }
        }
        return { hintCell: null, hintWord }
      }
      case 'shuffle': {
        // 重排：仅将当前网格内文字重新排列（保留字符多重集），保留已得分，清空已找集合
        const flat = grid.flat() as string[]
        // Fisher-Yates 洗牌
        for (let i = flat.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[flat[i], flat[j]] = [flat[j], flat[i]]
        }
        const newGrid: string[][] = []
        for (let r = 0; r < size; r++) {
          newGrid.push(flat.slice(r * size, (r + 1) * size))
        }
        // 重新计算潜在词池（基于新排列）
        const { trie } = await this.dictionaryService.loadAll()
        const newPotential = computePotential(newGrid, trie)
        const potentialWithRarity = newPotential.map((w) => {
          const dict = this.dictionaryService.findByWord(w)
          return { word: w, rarity: dict?.rarity ?? 'common', length: dict?.length ?? w.length }
        })
        await this.redis.hset(`match_session:${matchSessionId}`, {
          grid: JSON.stringify(newGrid),
          // 保留原 targetWords 仅作提示参考，潜在词池以新计算为准
          potentialWords: JSON.stringify(newPotential),
          potentialWordsWithRarity: JSON.stringify(potentialWithRarity),
          potentialCount: newPotential.length.toString(),
          size: size.toString(),
        })
        // clear found set but keep score
        await this.redis.del(`match_session:${matchSessionId}:found`)
        return { grid: newGrid, size }
      }
      case 'freeze': {
        const seconds = (cfg.params?.seconds as number) ?? 10
        const freezeUntil = Date.now() + seconds * 1000
        const lastWordAt = parseInt(session.lastWordAt || '0', 10)
        const updates: Record<string, string> = { freezeUntil: freezeUntil.toString() }
        // 冻结期间连击计时也暂停：延长 lastWordAt 使 combo 窗口不受冻结消耗
        if (lastWordAt > 0) {
          updates.lastWordAt = (lastWordAt + seconds * 1000).toString()
        }
        await this.redis.hset(`match_session:${matchSessionId}`, updates)
        return { freezeUntil, seconds }
      }
      case 'double': {
        await this.redis.hset(`match_session:${matchSessionId}`, { nextDouble: '1' })
        return { nextDouble: true }
      }
      default:
        return {}
    }
  }
}
