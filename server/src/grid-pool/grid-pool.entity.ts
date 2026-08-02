import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm'

/**
 * 预生成网格池表（对齐迭代2详细设计 §4.1.2）
 */
@Entity('grid_pool')
@Index('idx_gridpool_avail', ['difficulty', 'status'])
export class GridPoolEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'smallint' })
  size!: number

  @Column({ length: 16 })
  difficulty!: string

  @Column({ type: 'jsonb' })
  grid!: string[][]

  @Column({ type: 'jsonb' })
  targetWords!: string[]

  @Column({ type: 'int' })
  potentialCount!: number

  @Column({ type: 'jsonb' })
  potentialWords!: string[]

  @Column({ length: 16, default: 'available' })
  status!: string

  @CreateDateColumn()
  createdAt!: Date
}
