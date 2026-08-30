import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm'

@Entity('daily_challenges')
export class DailyChallengeEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'date', unique: true })
  date!: string

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

  @Column({ type: 'smallint', default: 5 })
  size!: number

  @Column({ type: 'int', default: 180 })
  duration!: number

  @Column({ type: 'boolean', default: false })
  settled!: boolean

  @CreateDateColumn()
  createdAt!: Date
}
