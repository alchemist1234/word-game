import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Interval } from '@nestjs/schedule'
import { UserEntity } from '../user/user.entity'

const MAX_STAMINA = 5
const RECOVER_MS = 60 * 60 * 1000

@Injectable()
export class EconomyService {
  private readonly logger = new Logger(EconomyService.name)

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  private calcRefill(stamina: number, updatedAt: Date, nowMs: number) {
    const last = updatedAt ? new Date(updatedAt).getTime() : nowMs
    const elapsed = nowMs - last
    if (elapsed < RECOVER_MS || stamina >= MAX_STAMINA) return { refill: 0, nextAt: null as Date | null, newUpdatedAt: updatedAt }
    const hours = Math.floor(elapsed / RECOVER_MS)
    const refill = Math.min(MAX_STAMINA - stamina, hours)
    const newUpdatedAt = new Date(last + refill * RECOVER_MS)
    const nextAt = stamina + refill >= MAX_STAMINA ? null : new Date(newUpdatedAt.getTime() + RECOVER_MS)
    return { refill, nextAt, newUpdatedAt }
  }

  async getStamina(userId: number): Promise<{ stamina: number; max: number; nextRecoverAt: Date | null }> {
    const user = await this.userRepo.findOne({ where: { id: userId } })
    if (!user) throw new BadRequestException('用户不存在')
    const now = Date.now()
    const normalizedStamina = Math.min(MAX_STAMINA, Math.max(0, user.stamina))
    const { refill, nextAt, newUpdatedAt } = this.calcRefill(
      normalizedStamina,
      user.staminaUpdatedAt,
      now,
    )
    if (normalizedStamina !== user.stamina || refill > 0) {
      user.stamina = normalizedStamina + refill
      user.staminaUpdatedAt = newUpdatedAt!
      await this.userRepo.save(user)
    }
    let nextRecoverAt: Date | null = nextAt
    if (user.stamina < MAX_STAMINA && !nextRecoverAt) {
      const last = refill > 0 ? newUpdatedAt!.getTime() : new Date(user.staminaUpdatedAt).getTime()
      nextRecoverAt = new Date(last + RECOVER_MS)
    }
    if (user.stamina >= MAX_STAMINA) nextRecoverAt = null
    return { stamina: user.stamina, max: MAX_STAMINA, nextRecoverAt }
  }

  async getBalance(userId: number): Promise<{
    coins: number
    diamonds: number
    stamina: number
    maxStamina: number
    nextRecoverAt: Date | null
    staminaNextAt: Date | null
    rankTier: number
    rankScore: number
  }> {
    const staminaInfo = await this.getStamina(userId)
    const user = await this.userRepo.findOne({ where: { id: userId } })
    if (!user) throw new BadRequestException('用户不存在')
    return {
      coins: user.coins,
      diamonds: user.diamonds,
      stamina: staminaInfo.stamina,
      maxStamina: staminaInfo.max,
      nextRecoverAt: staminaInfo.nextRecoverAt,
      staminaNextAt: staminaInfo.nextRecoverAt,
      rankTier: user.rankTier,
      rankScore: user.rankScore,
    }
  }

  async consumeStamina(userId: number, amount = 1): Promise<void> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new BadRequestException('体力消耗数量不合法')
    }
    const info = await this.getStamina(userId)
    if (info.stamina < amount) {
      throw new ForbiddenException('STAMINA_EXHAUSTED')
    }
    const result = await this.userRepo
      .createQueryBuilder()
      .update(UserEntity)
      .set({
        stamina: () => `"stamina" - ${amount}`,
        // 消耗后重置恢复基线，避免下一次读取按旧的满体力时间戳立即回满。
        staminaUpdatedAt: new Date(),
      })
      .where('id = :userId AND "stamina" >= :amount', { userId, amount })
      .execute()
    if (result.affected !== 1) {
      throw new ForbiddenException('STAMINA_EXHAUSTED')
    }
  }

  async addStamina(userId: number, amount = 1): Promise<void> {
    if (!Number.isInteger(amount) || amount <= 0) return
    const user = await this.userRepo.findOne({ where: { id: userId } })
    if (!user) throw new BadRequestException('用户不存在')
    user.stamina = Math.min(MAX_STAMINA, Math.max(0, user.stamina) + amount)
    user.staminaUpdatedAt = new Date()
    await this.userRepo.save(user)
  }

  async addCoins(userId: number, amount: number): Promise<void> {
    if (!Number.isInteger(amount) || amount < 0) throw new BadRequestException('金币数量不合法')
    if (amount === 0) return
    await this.userRepo.increment({ id: userId }, 'coins', amount)
  }

  async addDiamonds(userId: number, amount: number): Promise<void> {
    if (!Number.isInteger(amount) || amount < 0) throw new BadRequestException('钻石数量不合法')
    if (amount === 0) return
    await this.userRepo.increment({ id: userId }, 'diamonds', amount)
  }

  @Interval(5 * 60 * 1000)
  async cronRefill(): Promise<void> {
    // lazy refill is sufficient; this cron is fallback for inactive users
    // paging scan to avoid full table lock
    try {
      const users = await this.userRepo.find({ where: {} as unknown as Record<string, unknown> })
      const now = Date.now()
      for (const u of users) {
        const normalizedStamina = Math.min(MAX_STAMINA, Math.max(0, u.stamina))
        if (normalizedStamina !== u.stamina) {
          u.stamina = normalizedStamina
          await this.userRepo.save(u)
        }
        if (u.stamina >= MAX_STAMINA) continue
        const { refill, newUpdatedAt } = this.calcRefill(u.stamina, u.staminaUpdatedAt, now)
        if (refill > 0) {
          u.stamina = Math.min(MAX_STAMINA, u.stamina + refill)
          u.staminaUpdatedAt = newUpdatedAt!
          await this.userRepo.save(u)
        }
      }
    } catch (e) {
      this.logger.warn(`cronRefill failed: ${(e as Error).message}`)
    }
  }
}
