import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
} from 'typeorm'
import type { GameEndResult } from './game.service'

/**
 * 对局结算幂等账本：matchSessionId 唯一，数据库事务提交后才算结算完成。
 */
@Entity('game_settlements')
export class GameSettlementEntity {
  @PrimaryColumn({ type: 'uuid' })
  matchSessionId!: string

  @Column({ type: 'bigint' })
  userId!: number

  @Column({ type: 'jsonb' })
  result!: GameEndResult

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
