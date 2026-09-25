import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm'

/** 每日挑战奖励幂等键：同一日期/用户最多发一次。 */
@Entity('daily_reward_claims')
export class DailyRewardClaimEntity {
  @PrimaryColumn({ type: 'date', name: 'date' })
  date!: string

  @PrimaryColumn({ type: 'bigint', name: 'user_id' })
  userId!: number

  @Column({ type: 'int' })
  coins!: number

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date
}
