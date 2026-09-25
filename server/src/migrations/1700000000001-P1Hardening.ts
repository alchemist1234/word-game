import { MigrationInterface, QueryRunner } from 'typeorm'

/** P1：显式固化体力、8a/9-1 字段与可重试副作用账本。 */
export class P1Hardening1700000000001 implements MigrationInterface {
  name = 'P1Hardening1700000000001'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "stamina" SET DEFAULT 5
    `)
    await queryRunner.query(`
      UPDATE "users"
      SET "stamina" = LEAST(GREATEST("stamina", 0), 5)
      WHERE "stamina" < 0 OR "stamina" > 5
    `)
    await queryRunner.query(`
      ALTER TABLE "matches"
        ADD COLUMN IF NOT EXISTS "mode" character varying(16) DEFAULT 'casual' NOT NULL
    `)
    await queryRunner.query(`
      ALTER TABLE "match_players"
        ADD COLUMN IF NOT EXISTS "isAi" boolean DEFAULT false NOT NULL,
        ADD COLUMN IF NOT EXISTS "aiLevel" character varying(16)
    `)
    await queryRunner.query(`
      ALTER TABLE "word_applies"
        ADD COLUMN IF NOT EXISTS "status" character varying(16) DEFAULT 'pending' NOT NULL,
        ADD COLUMN IF NOT EXISTS "source" character varying(16) DEFAULT 'game' NOT NULL,
        ADD COLUMN IF NOT EXISTS "match_session_id" character varying(64),
        ADD COLUMN IF NOT EXISTS "cells" jsonb,
        ADD COLUMN IF NOT EXISTS "grid_seed" character varying(64),
        ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now()
    `)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_wordapply_word_user_p1"
        ON "word_applies" ("word", "user_id")
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_wordapply_user_created_p1"
        ON "word_applies" ("user_id", "created_at")
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
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "season_settlements" (
        "period" character varying(16) NOT NULL,
        "settledAt" timestamptz NOT NULL DEFAULT now(),
        "userCount" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_season_settlements" PRIMARY KEY ("period")
      )
    `)
  }

  public async down(): Promise<void> {
    // 不自动恢复已归一化的体力数据，避免回滚造成重复奖励/进度。
  }
}
