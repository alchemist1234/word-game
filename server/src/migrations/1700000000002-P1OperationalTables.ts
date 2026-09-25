import { MigrationInterface, QueryRunner } from 'typeorm'

/** P1 operational tables added after the first dev migration was already applied. */
export class P1OperationalTables1700000000002 implements MigrationInterface {
  name = 'P1OperationalTables1700000000002'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_match_players_match_sid"
        ON "match_players" ("matchId", sid)
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "daily_reward_claims" (
        "date" date NOT NULL,
        "user_id" bigint NOT NULL,
        "coins" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_daily_reward_claims" PRIMARY KEY ("date", "user_id")
      )
    `)
  }

  public async down(): Promise<void> {
    // 保留奖励幂等账本，避免回滚后重复发币。
  }
}
