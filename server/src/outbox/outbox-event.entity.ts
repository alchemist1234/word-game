import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm'

/**
 * PostgreSQL transactional outbox。
 * 结算事务只负责写本表；Redis/成就等外部副作用由可重试消费者处理。
 */
@Entity('outbox_events')
@Index('uq_outbox_dedupe_key', ['dedupeKey'], { unique: true })
@Index('idx_outbox_pending', ['processedAt', 'availableAt'])
export class OutboxEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'varchar', length: 64 })
  eventType!: string

  @Column({ type: 'varchar', length: 64 })
  aggregateType!: string

  @Column({ type: 'varchar', length: 128 })
  aggregateId!: string

  @Column({ type: 'varchar', length: 160 })
  dedupeKey!: string

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>

  @Column({ type: 'int', default: 0 })
  attempts!: number

  @Column({ type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date

  @Column({ type: 'timestamptz', nullable: true })
  lockedAt!: Date | null

  @Column({ type: 'varchar', length: 64, nullable: true })
  lockedBy!: string | null

  @Column({ type: 'timestamptz', nullable: true })
  processedAt!: Date | null

  @Column({ type: 'text', nullable: true })
  lastError!: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
