import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'

/**
 * 用户申请收录词（一人一票去重）
 * 对齐 doc/迭代9-1详细设计.md §4
 */
@Entity('word_applies')
@Index('idx_wordapply_word', ['word'])
@Index('idx_wordapply_user', ['userId'])
@Index('idx_wordapply_word_user', ['word', 'userId'], { unique: true })
export class WordApplyEntity {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 16 })
  word!: string

  @Column({ type: 'bigint', name: 'user_id' })
  userId!: number

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: string // pending | auto_merged | approved | rejected（后两者管理端预留）

  @Column({ type: 'varchar', length: 16, default: 'game' })
  source!: string // game（带路径证据）| manual（结算页手输）

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'match_session_id' })
  matchSessionId!: string | null

  @Column({ type: 'jsonb', nullable: true })
  cells!: Array<{ row: number; col: number }> | null

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'grid_seed' })
  gridSeed!: string | null

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date
}
