import { Entity, PrimaryColumn, Column, Index } from 'typeorm'

/**
 * 词库表 entity（对齐 GDD §7.4.5）
 * rarity 存 string，业务层转换到 Rarity 联合类型
 */
@Entity('dictionary')
@Index('idx_dict_rarity', ['rarity'])
@Index('idx_dict_length', ['length'])
export class DictionaryEntity {
  @PrimaryColumn({ length: 16 })
  word!: string

  @Column({ type: 'smallint' })
  length!: number

  @Column({ type: 'real' })
  frequency!: number

  @Column({ length: 8 })
  rarity!: string // common / normal / rare / idiom

  @Column({ type: 'jsonb', default: [] })
  tags!: string[]

  @Column({ type: 'jsonb' })
  chars!: string[]

  @Column({ type: 'text', nullable: true })
  meaning!: string | null
}
