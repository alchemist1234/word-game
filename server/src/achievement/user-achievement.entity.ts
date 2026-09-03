import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm'

@Entity('user_achievements')
@Index(['userId', 'achievementId'], { unique: true })
export class UserAchievementEntity {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'bigint', name: 'user_id' })
  userId!: number

  @Column({ type: 'varchar', length: 32, name: 'achievement_id' })
  achievementId!: string

  @CreateDateColumn({ name: 'unlocked_at' })
  unlockedAt!: Date

  @Column({ type: 'boolean', default: false })
  claimed!: boolean
}
