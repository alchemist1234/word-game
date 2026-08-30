import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm'

@Entity('challenges')
export class ChallengeEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'varchar', length: 64 })
  gridSeed!: string

  @Column({ type: 'jsonb' })
  grid!: string[][]

  @Column({ type: 'jsonb' })
  targetWords!: string[]

  @Column({ type: 'jsonb' })
  potentialWords!: string[]

  @Column({ type: 'int' })
  potentialCount!: number

  @Column({ type: 'smallint' })
  size!: number

  @Column({ type: 'int', default: 180 })
  duration!: number

  @Column({ type: 'bigint' })
  challengerId!: number

  @Column({ type: 'int' })
  challengerScore!: number

  @Column({ type: 'varchar', length: 64, nullable: true })
  challengerNickname!: string | null

  @Column({ type: 'int', default: 0 })
  attempts!: number

  @Column({ type: 'int', default: 0 })
  bestScore!: number

  @Column({ type: 'bigint', nullable: true })
  bestUserId!: number | null

  @CreateDateColumn()
  createdAt!: Date
}
