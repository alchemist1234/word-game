import { Entity, PrimaryColumn, Column } from 'typeorm'

/** 赛季结算幂等账本，防止 cron/手动补偿重复发奖。 */
@Entity('season_settlements')
export class SeasonSettlementEntity {
  @PrimaryColumn({ type: 'varchar', length: 16 })
  period!: string

  @Column({ type: 'timestamptz', default: () => 'now()' })
  settledAt!: Date

  @Column({ type: 'int', default: 0 })
  userCount!: number
}
