import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm'

/** 用户表（对齐 GDD §7.4.1） */
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number

  @Column({ type: 'varchar', length: 20, unique: true, nullable: true })
  phone!: string | null

  @Column({ type: 'varchar', length: 64, nullable: true })
  nickname!: string | null

  @Column({ type: 'text', nullable: true })
  avatar!: string | null

  @Column({ type: 'int', default: 1 })
  level!: number

  @Column({ type: 'int', default: 0 })
  exp!: number

  @Column({ type: 'smallint', default: 1 })
  rankTier!: number

  @Column({ type: 'int', default: 0 })
  rankScore!: number

  @Column({ type: 'int', default: 0 })
  coins!: number

  @Column({ type: 'int', default: 0 })
  diamonds!: number

  @Column({ type: 'int', default: 5 })
  stamina!: number

  @CreateDateColumn()
  staminaUpdatedAt!: Date

  @Column({ type: 'int', default: 1 })
  chapterCurrent!: number

  @CreateDateColumn()
  createdAt!: Date
}
