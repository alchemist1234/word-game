import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm'

@Entity('leaderboard_snapshots')
@Unique('uq_snapshot_period_user', ['type', 'period', 'userId'])
@Index('idx_snapshot_type_period', ['type', 'period'])
export class LeaderboardSnapshotEntity {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 16 })
  type!: string

  @Column({ type: 'varchar', length: 32 })
  period!: string

  @Column({ type: 'bigint' })
  userId!: number

  @Column({ type: 'int' })
  score!: number

  @Column({ type: 'int' })
  rank!: number

  @CreateDateColumn()
  archivedAt!: Date
}
