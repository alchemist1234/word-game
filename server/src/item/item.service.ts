import { Injectable, BadRequestException, NotFoundException, Inject, Logger } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
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

interface GridPos {
  row: number
  col: number
}

function findWordPath(grid: string[][], word: string): GridPos[] | null {
  const size = grid.length
  const directions = [-1, -1, -1, 0, 0, 1, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1]
  const queue: Array<{ cell: GridPos; index: number; path: GridPos[]; used: Set<string> }> = []
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < grid[row].length; col += 1) {
      if (grid[row][col] === word[0]) {
        queue.push({
          cell: { row, col },
          index: 1,
          path: [{ row, col }],
          used: new Set([`${row},${col}`]),
        })
      }
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]
    if (current.index === word.length) return current.path
    for (let i = 0; i < 8; i += 1) {
      const row = current.cell.row + directions[i * 2]
      const col = current.cell.col + directions[i * 2 + 1]
      const key = `${row},${col}`
      if (row < 0 || col < 0 || row >= size || col >= grid[row].length) continue
      if (current.used.has(key) || grid[row][col] !== word[current.index]) continue
      const used = new Set(current.used)
      used.add(key)
      queue.push({
        cell: { row, col },
        index: current.index + 1,
        path: [...current.path, { row, col }],
        used,
      })
    }
  }
  return null
}

@Injectable()
export class ItemService {
  private readonly logger = new Logger(ItemService.name)
  private readonly items: ItemConfig[] = itemsJson as ItemConfig[]

  constructor(
    @InjectRepository(UserItemEntity) private readonly itemRepo: Repository<UserItemEntity>,
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
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
    if (!Number.isInteger(quantity) || quantity <= 0) throw new BadRequestException('数量不合法')
    return this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(UserEntity)
      const itemRepo = manager.getRepository(UserItemEntity)
      const totalCost = cfg.cost * quantity
      const user = await userRepo.findOne({ where: { id: userId } })
      if (!user) throw new NotFoundException('用户不存在')
      if (cfg.costType === 'coins') {
        if (user.coins < totalCost) throw new BadRequestException('金币不足')
        user.coins -= totalCost
      } else {
        if (user.diamonds < totalCost) throw new BadRequestException('钻石不足')
        user.diamonds -= totalCost
      }
      await userRepo.save(user)
      let inventory = await itemRepo.findOne({ where: { userId, itemId } })
      if (!inventory) {
        inventory = itemRepo.create({ userId, itemId, quantity: 0 })
      }
      inventory.quantity += quantity
      await itemRepo.save(inventory)
      return { quantity: inventory.quantity }
    })
  }

  private getMode(session: Record<string, string>): string {
    if (session.isLevelMode === '1') return 'level'
    if (session.isDailyMode === '1') return 'daily'
    if (session.isChallengeMode === '1') return 'friend'
    if (session.matchId) {
      return session.pvpType === 'pvp_4p' ? 'pvp_4p' : 'pvp_1v1'
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
    const startedAt = parseInt(session.startedAt || '0', 10)
    const duration = parseInt(session.duration || '0', 10)
    const fallbackDeadline =
      startedAt > 0 && duration > 0
        ? startedAt + duration * 1000
        : 0
    const deadlineAt = parseInt(
      session.deadlineAt || String(fallbackDeadline),
      10,
    )
    if (deadlineAt > 0 && Date.now() > deadlineAt) {
      throw new BadRequestException('对局已结束')
    }
    const mode = this.getMode(session)
    if (!cfg.allowedModes.includes(mode)) {
      throw new BadRequestException('该道具在此模式不可用')
    }
    if (cfg.bossOnly) {
      const isBoss = session.levelId ? this.findLevelBoss(session.levelId) : false
      if (!isBoss) throw new BadRequestException('该道具仅限 Boss 关使用')
    }
    // usage limit + cost/effect rollback
    const usageKey = `item_usage:${matchSessionId}:${itemId}`
    const lockKey = `item_lock:${matchSessionId}:${itemId}`
    const lockToken = uuidv4()
    const lock = await this.redis.set(lockKey, lockToken, 'EX', 10, 'NX')
    if (lock !== 'OK') throw new BadRequestException('道具正在使用中，请稍后重试')
    let usageCount = 0
    let inventoryRow: UserItemEntity | null = null
    let userRow: UserEntity | null = null
    let deducted = false
    let shuffleRollback: { fields: Record<string, string>; found: string[] } | null = null
    try {
      usageCount = await this.redis.incr(usageKey)
      await this.redis.expire(usageKey, 600)
      if (usageCount > cfg.maxPerLevel) {
        await this.redis.decr(usageKey)
        throw new BadRequestException('已达本局使用上限')
      }

      inventoryRow = await this.itemRepo.findOne({ where: { userId, itemId } })
      if (inventoryRow && inventoryRow.quantity > 0) {
        inventoryRow.quantity -= 1
        await this.itemRepo.save(inventoryRow)
        deducted = true
      } else {
        userRow = await this.userRepo.findOne({ where: { id: userId } })
        if (!userRow) throw new NotFoundException('用户不存在')
        if (cfg.costType === 'coins') {
          if (userRow.coins < cfg.cost) throw new BadRequestException('金币不足')
          userRow.coins -= cfg.cost
        } else {
          if (userRow.diamonds < cfg.cost) throw new BadRequestException('钻石不足')
          userRow.diamonds -= cfg.cost
        }
        await this.userRepo.save(userRow)
        deducted = true
      }

      if (cfg.effect === 'shuffle') {
        shuffleRollback = {
          fields: {
            grid: session.grid,
            potentialWords: session.potentialWords ?? '[]',
            potentialWordsWithRarity: session.potentialWordsWithRarity ?? '[]',
            potentialCount: session.potentialCount ?? '0',
            size: session.size ?? String(session.grid ? JSON.parse(session.grid).length : 0),
          },
          found: await this.redis.smembers(`match_session:${matchSessionId}:found`),
        }
      }
      const result = await this.applyEffect(cfg, session, matchSessionId, userId)
      return result
    } catch (error) {
      // 背包/货币与 Redis 次数均在同一临界区内，失败时尽力补偿。
      try {
        if (shuffleRollback) {
          await this.redis.hset(`match_session:${matchSessionId}`, shuffleRollback.fields)
          const foundKey = `match_session:${matchSessionId}:found`
          await this.redis.del(foundKey)
          if (shuffleRollback.found.length > 0) {
            await this.redis.sadd(foundKey, ...shuffleRollback.found)
          }
        }
        if (deducted && inventoryRow) {
          inventoryRow.quantity += 1
          await this.itemRepo.save(inventoryRow)
        } else if (deducted && userRow) {
          if (cfg.costType === 'coins') userRow.coins += cfg.cost
          else userRow.diamonds += cfg.cost
          await this.userRepo.save(userRow)
        }
        if (usageCount > 0 && usageCount <= cfg.maxPerLevel) {
          await this.redis.decr(usageKey)
        }
      } catch (rollbackError) {
        this.logger.warn(`item rollback failed: ${(rollbackError as Error).message}`)
      }
      throw error
    } finally {
      try {
        await this.redis.eval(
          `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`,
          1,
          lockKey,
          lockToken,
        )
      } catch (error) {
        this.logger.warn(`item lock release failed: ${(error as Error).message}`)
      }
    }
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
          // fallback: use an unrecorded potential word
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
        const now = Date.now()
        const freezeUntil = now + seconds * 1000
        const startedAt = parseInt(session.startedAt || '0', 10)
        const duration = parseInt(session.duration || '0', 10)
        const fallbackDeadline =
          startedAt > 0 && duration > 0
            ? startedAt + duration * 1000
            : 0
        const currentDeadline = parseInt(
          session.deadlineAt || String(fallbackDeadline),
          10,
        )
        const deadlineBase = currentDeadline > now ? currentDeadline : now
        const lastWordAt = parseInt(session.lastWordAt || '0', 10)
        const updates: Record<string, string> = {
          freezeUntil: freezeUntil.toString(),
          deadlineAt: (deadlineBase + seconds * 1000).toString(),
        }
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
      case 'peek': {
        const targetWords = session.targetWords
          ? (JSON.parse(session.targetWords) as string[])
          : []
        const foundKey = `match_session:${matchSessionId}:found`
        const foundSet = new Set(await this.redis.smembers(foundKey))
        const targets: Array<{ word: string; cells: GridPos[] }> = []
        for (const word of targetWords) {
          if (foundSet.has(word)) continue
          const path = findWordPath(grid, word)
          if (path) targets.push({ word, cells: path })
        }
        return {
          seconds: (cfg.params?.seconds as number) ?? 3,
          targets,
        }
      }
      default:
        throw new BadRequestException('道具效果未注册')
    }
  }
}
