import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm'

/** 多端账号绑定（对齐 GDD §7.4.2） */
@Entity('user_auths')
@Index('idx_userauth_platform_openid', ['platform', 'openid'], { unique: true })
export class UserAuthEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number

  @Column({ type: 'bigint', name: 'user_id' })
  userId!: number

  @Column({ length: 32 })
  platform!: string // h5 / wechat_mp / ...

  @Column({ length: 128 })
  openid!: string

  @Column({ type: 'varchar', length: 128, nullable: true })
  unionid!: string | null

  @CreateDateColumn()
  createdAt!: Date
}
