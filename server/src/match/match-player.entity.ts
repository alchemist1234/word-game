import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm'

/**
 * 对局玩家表（GDD §7.4.3 注释：对局玩家分数实时存 Redis，结束后落库）
 * 迭代6详细设计 §3.2
 */
@Entity('match_players')
export class MatchPlayerEntity {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'uuid' })
  matchId!: string

  @Column({ type: 'bigint' })
  userId!: number

  @Column({ type: 'int', default: 0 })
  score!: number

  /** 稀有词数（rarity ∈ {idiom, rare}），胜负 tie-break 第 2 键 */
  @Column({ type: 'int', default: 0 })
  rareCount!: number

  @Column({ type: 'int', default: 0 })
  maxCombo!: number

  /** 1 胜 / 2 负（平局皆 1） */
  @Column({ type: 'smallint' })
  rank!: number

  /** 对应 match_session（Redis 会话 id） */
  @Column({ type: 'varchar', length: 36 })
  sid!: string
}
