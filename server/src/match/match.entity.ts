import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm'

/**
 * 对局表（对齐 GDD §7.4.3 / 迭代6详细设计 §3.1）
 * 实时 1v1 对战记录：双方同网格，结束后落库胜负
 */
@Entity('matches')
export class MatchEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'varchar', length: 16, default: 'pvp_1v1' })
  type!: string

  /** grid_pool.id（同一网格种子，双方共用） */
  @Column({ type: 'varchar', length: 64 })
  gridSeed!: string

  @Column({ type: 'jsonb' })
  grid!: string[][]

  @Column({ type: 'jsonb' })
  targetWords!: string[]

  @Column({ type: 'varchar', length: 16, default: 'ongoing' })
  status!: string

  @Column({ type: 'bigint', nullable: true })
  winnerId!: number | null

  @CreateDateColumn()
  startedAt!: Date

  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null
}
