import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm'

@Entity('challenge_attempts')
@Unique('uq_challenge_session', ['challengeId', 'matchSessionId'])
@Index('idx_challenge_attempt_challenge', ['challengeId'])
@Index('idx_challenge_attempt_user', ['userId'])
export class ChallengeAttemptEntity {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'uuid' })
  challengeId!: string

  @Column({ type: 'bigint' })
  userId!: number

  @Column({ type: 'varchar', length: 64 })
  matchSessionId!: string

  @Column({ type: 'int' })
  score!: number

  @Column({ type: 'int', default: 0 })
  maxCombo!: number

  @Column({ type: 'int', default: 0 })
  foundCount!: number

  @Column({ type: 'boolean', default: false })
  beat!: boolean

  @CreateDateColumn()
  createdAt!: Date
}
