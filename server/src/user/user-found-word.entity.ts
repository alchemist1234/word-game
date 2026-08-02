import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm'

/** 图鉴：用户已找到的词（对齐 GDD §5.4） */
@Entity('user_found_words')
@Index('idx_userfoundword_user_word', ['userId', 'word'], { unique: true })
export class UserFoundWordEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number

  @Column({ type: 'bigint', name: 'user_id' })
  userId!: number

  @Column({ length: 16 })
  word!: string

  @Column({ length: 8 })
  rarity!: string

  @Column({ type: 'int', default: 1 })
  foundCount!: number

  @CreateDateColumn()
  firstFoundAt!: Date
}
