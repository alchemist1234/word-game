import { MigrationInterface, QueryRunner } from 'typeorm'

/** P1：对战玩家落库增加幂等约束，避免重试产生重复分数行。 */
export class MatchIdempotency1700000000003 implements MigrationInterface {
  name = 'MatchIdempotency1700000000003'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_match_players_match_sid"
        ON "match_players" ("matchId", sid)
    `)
  }

  public async down(): Promise<void> {
    // 保留唯一约束，避免回滚后破坏结算幂等性。
  }
}
