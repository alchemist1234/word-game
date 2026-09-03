import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm'

@Entity('user_items')
@Index(['userId', 'itemId'], { unique: true })
export class UserItemEntity {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'bigint', name: 'user_id' })
  userId!: number

  @Column({ type: 'varchar', length: 32, name: 'item_id' })
  itemId!: string

  @Column({ type: 'int', default: 0 })
  quantity!: number
}
