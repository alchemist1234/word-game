import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm'

@Entity('daily_attempts')
@Unique('uq_daily_session', ['date', 'userId', 'matchSessionId'])
@Index('idx_daily_attempt_date_user', ['date', 'userId'])
export class DailyAttemptEntity {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'date' })
  date!: string

  @Column({ type: 'bigint' })
  userId!: number

  @Column({ type: 'int' })
  score!: number

  @Column({ type: 'int', default: 0 })
  maxCombo!: number

  @Column({ type: 'int', default: 0 })
  foundCount!: number

  @Column({ type: 'varchar', length: 64 })
  matchSessionId!: string

  @CreateDateColumn()
  createdAt!: Date
}
