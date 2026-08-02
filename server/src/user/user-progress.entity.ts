import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm'

/** 闯关进度 */
@Entity('user_progress')
@Index('idx_userprogress_user_level', ['userId', 'levelId'], { unique: true })
export class UserProgressEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number

  @Column({ type: 'bigint', name: 'user_id' })
  userId!: number

  @Column({ length: 16, name: 'level_id' })
  levelId!: string

  @Column({ type: 'smallint', default: 0 })
  stars!: number

  @Column({ type: 'int', default: 0 })
  bestScore!: number

  @Column({ type: 'boolean', default: false })
  completed!: boolean

  @Column({
    type: 'timestamptz',
    default: () => 'now()',
  })
  updatedAt!: Date
}
