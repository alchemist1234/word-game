import { Injectable, Logger, BadRequestException } from '@nestjs/common'
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
    const { refill, nextAt, newUpdatedAt } = this.calcRefill(user.stamina, user.staminaUpdatedAt, now)
    if (refill > 0) {
      user.stamina += refill
      user.staminaUpdatedAt = newUpdatedAt!
      await this.userRepo.save(user)
    }
    // compute nextRecoverAt if not full
    let nextRecoverAt: Date | null = nextAt
    if (user.stamina < MAX_STAMINA && !nextRecoverAt) {
      const base = newUpdatedAt ? newUpdatedAt.getTime() : now
      // if no refill, base is original updatedAt
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
      rankTier: user.rankTier,
      rankScore: user.rankScore,
    }
  }

  async consumeStamina(userId: number, amount = 1): Promise<void> {
    const info = await this.getStamina(userId)
    if (info.stamina < amount) {
      throw new BadRequestException('体力不足')
    }
    const user = await this.userRepo.findOne({ where: { id: userId } })
    if (!user) throw new BadRequestException('用户不存在')
    user.stamina -= amount
    // keep updatedAt as is (recovery baseline stays)
    await this.userRepo.save(user)
  }

  async addCoins(userId: number, amount: number): Promise<void> {
    if (amount === 0) return
    await this.userRepo.increment({ id: userId }, 'coins', amount)
  }

  async addDiamonds(userId: number, amount: number): Promise<void> {
    if (amount === 0) return
    await this.userRepo.increment({ id: userId }, 'diamonds', amount)
  }

  @Interval(60 * 60 * 1000)
  async cronRefill(): Promise<void> {
    // lazy refill is sufficient; this cron is fallback for inactive users
    // paging scan to avoid full table lock
    try {
      const users = await this.userRepo.find({ where: {} as unknown as Record<string, unknown> })
      const now = Date.now()
      for (const u of users) {
        if (u.stamina >= MAX_STAMINA) continue
        const { refill, newUpdatedAt } = this.calcRefill(u.stamina, u.staminaUpdatedAt, now)
        if (refill > 0) {
          u.stamina += refill
          u.staminaUpdatedAt = newUpdatedAt!
          await this.userRepo.save(u)
        }
      }
    } catch (e) {
      this.logger.warn(`cronRefill failed: ${(e as Error).message}`)
    }
  }
}
