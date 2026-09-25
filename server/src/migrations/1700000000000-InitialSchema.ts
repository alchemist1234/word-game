import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 可在空库执行，也可在历史 synchronize 库上安全重跑的基线迁移。
 * 生产环境由 migration job 单独执行，应用副本不负责 DDL。
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" bigserial NOT NULL,
        "phone" character varying(20),
        "nickname" character varying(64),
        "avatar" text,
        "level" integer DEFAULT 1 NOT NULL,
        "exp" integer DEFAULT 0 NOT NULL,
        "rankTier" smallint DEFAULT 1 NOT NULL,
        "rankScore" integer DEFAULT 0 NOT NULL,
        "coins" integer DEFAULT 0 NOT NULL,
        "diamonds" integer DEFAULT 0 NOT NULL,
        "stamina" integer DEFAULT 5 NOT NULL,
        "chapterCurrent" integer DEFAULT 1 NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "staminaUpdatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_initial" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_phone_initial" UNIQUE ("phone")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_auths" (
        "id" bigserial NOT NULL,
        "user_id" bigint NOT NULL,
        "platform" character varying(32) NOT NULL,
        "openid" character varying(128) NOT NULL,
        "unionid" character varying(128),
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_auths_initial" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_progress" (
        "id" bigserial NOT NULL,
        "user_id" bigint NOT NULL,
        "level_id" character varying(16) NOT NULL,
        "stars" smallint DEFAULT 0 NOT NULL,
        "bestScore" integer DEFAULT 0 NOT NULL,
        "completed" boolean DEFAULT false NOT NULL,
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_progress_initial" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_found_words" (
        "id" bigserial NOT NULL,
        "user_id" bigint NOT NULL,
        "word" character varying(16) NOT NULL,
        "rarity" character varying(8) NOT NULL,
        "found_count" integer DEFAULT 1 NOT NULL,
        "first_found_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_found_words_initial" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dictionary" (
        "word" character varying(16) NOT NULL,
        "length" smallint NOT NULL,
        "frequency" real NOT NULL,
        "rarity" character varying(8) NOT NULL,
        "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "chars" jsonb NOT NULL,
        "meaning" text,
        CONSTRAINT "PK_dictionary_initial" PRIMARY KEY ("word")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "grid_pool" (
        "id" uuid NOT NULL,
        "size" smallint NOT NULL,
        "difficulty" character varying(16) NOT NULL,
        "grid" jsonb NOT NULL,
        "targetWords" jsonb NOT NULL,
        "potentialCount" integer NOT NULL,
        "potentialWords" jsonb NOT NULL,
        "status" character varying(16) DEFAULT 'available' NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_grid_pool_initial" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "matches" (
        "id" uuid NOT NULL,
        "type" character varying(16) DEFAULT 'pvp_1v1' NOT NULL,
        "mode" character varying(16) DEFAULT 'casual' NOT NULL,
        "gridSeed" character varying(64) NOT NULL,
        "grid" jsonb NOT NULL,
        "targetWords" jsonb NOT NULL,
        "status" character varying(16) DEFAULT 'ongoing' NOT NULL,
        "winnerId" bigint,
        "startedAt" timestamp NOT NULL DEFAULT now(),
        "endedAt" timestamptz,
        CONSTRAINT "PK_matches_initial" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "match_players" (
        "id" serial NOT NULL,
        "matchId" uuid NOT NULL,
        "userId" bigint NOT NULL,
        "score" integer DEFAULT 0 NOT NULL,
        "rareCount" integer DEFAULT 0 NOT NULL,
        "maxCombo" integer DEFAULT 0 NOT NULL,
        "rank" smallint NOT NULL,
        "sid" character varying(36) NOT NULL,
        "isAi" boolean DEFAULT false NOT NULL,
        "aiLevel" character varying(16),
        CONSTRAINT "PK_match_players_initial" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "challenges" (
        "id" uuid NOT NULL,
        "gridSeed" character varying(64) NOT NULL,
        "grid" jsonb NOT NULL,
        "targetWords" jsonb NOT NULL,
        "potentialWords" jsonb NOT NULL,
        "potentialCount" integer NOT NULL,
        "size" smallint NOT NULL,
        "duration" integer DEFAULT 180 NOT NULL,
        "challengerId" bigint NOT NULL,
        "challengerScore" integer NOT NULL,
        "challengerNickname" character varying(64),
        "attempts" integer DEFAULT 0 NOT NULL,
        "bestScore" integer DEFAULT 0 NOT NULL,
        "bestUserId" bigint,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_challenges_initial" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "challenge_attempts" (
        "id" serial NOT NULL,
        "challengeId" uuid NOT NULL,
        "userId" bigint NOT NULL,
        "matchSessionId" character varying(64) NOT NULL,
        "score" integer NOT NULL,
        "maxCombo" integer DEFAULT 0 NOT NULL,
        "foundCount" integer DEFAULT 0 NOT NULL,
        "beat" boolean DEFAULT false NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_challenge_attempts_initial" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "daily_challenges" (
        "id" uuid NOT NULL,
        "date" date NOT NULL,
        "gridSeed" character varying(64) NOT NULL,
        "grid" jsonb NOT NULL,
        "targetWords" jsonb NOT NULL,
        "potentialWords" jsonb NOT NULL,
        "potentialCount" integer NOT NULL,
        "size" smallint DEFAULT 5 NOT NULL,
        "duration" integer DEFAULT 180 NOT NULL,
        "settled" boolean DEFAULT false NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_daily_challenges_initial" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_daily_challenges_date_initial" UNIQUE ("date")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "daily_attempts" (
        "id" serial NOT NULL,
        "date" date NOT NULL,
        "userId" bigint NOT NULL,
        "score" integer NOT NULL,
        "maxCombo" integer DEFAULT 0 NOT NULL,
        "foundCount" integer DEFAULT 0 NOT NULL,
        "matchSessionId" character varying(64) NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_daily_attempts_initial" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "daily_reward_claims" (
        "date" date NOT NULL,
        "user_id" bigint NOT NULL,
        "coins" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_daily_reward_claims_initial" PRIMARY KEY ("date", "user_id")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leaderboard_snapshots" (
        "id" serial NOT NULL,
        "type" character varying(16) NOT NULL,
        "period" character varying(32) NOT NULL,
        "userId" bigint NOT NULL,
        "score" integer NOT NULL,
        "rank" integer NOT NULL,
        "archivedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leaderboard_snapshots_initial" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_items" (
        "id" serial NOT NULL,
        "user_id" bigint NOT NULL,
        "item_id" character varying(32) NOT NULL,
        "quantity" integer DEFAULT 0 NOT NULL,
        CONSTRAINT "PK_user_items_initial" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_achievements" (
        "id" serial NOT NULL,
        "user_id" bigint NOT NULL,
        "achievement_id" character varying(32) NOT NULL,
        "unlocked_at" timestamp NOT NULL DEFAULT now(),
        "claimed" boolean DEFAULT false NOT NULL,
        CONSTRAINT "PK_user_achievements_initial" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "word_applies" (
        "id" serial NOT NULL,
        "word" character varying(16) NOT NULL,
        "user_id" bigint NOT NULL,
        "status" character varying(16) DEFAULT 'pending' NOT NULL,
        "source" character varying(16) DEFAULT 'game' NOT NULL,
        "match_session_id" character varying(64),
        "cells" jsonb,
        "grid_seed" character varying(64),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_word_applies_initial" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "game_settlements" (
        "matchSessionId" uuid NOT NULL,
        "userId" bigint NOT NULL,
        "result" jsonb NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_game_settlements_initial" PRIMARY KEY ("matchSessionId")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "outbox_events" (
        "id" uuid NOT NULL,
        "eventType" character varying(64) NOT NULL,
        "aggregateType" character varying(64) NOT NULL,
        "aggregateId" character varying(128) NOT NULL,
        "dedupeKey" character varying(160) NOT NULL,
        "payload" jsonb NOT NULL,
        "attempts" integer DEFAULT 0 NOT NULL,
        "availableAt" timestamptz NOT NULL DEFAULT now(),
        "lockedAt" timestamptz,
        "lockedBy" character varying(64),
        "processedAt" timestamptz,
        "lastError" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_outbox_events_initial" PRIMARY KEY ("id")
      )
    `)

    const indexes = [
      ['CREATE UNIQUE INDEX IF NOT EXISTS "idx_userauth_platform_openid_initial" ON "user_auths" ("platform", "openid")'],
      ['CREATE INDEX IF NOT EXISTS "idx_challenge_attempt_challenge_initial" ON "challenge_attempts" ("challengeId")'],
      ['CREATE INDEX IF NOT EXISTS "idx_challenge_attempt_user_initial" ON "challenge_attempts" ("userId")'],
      ['CREATE UNIQUE INDEX IF NOT EXISTS "uq_challenge_session_initial" ON "challenge_attempts" ("challengeId", "matchSessionId")'],
      ['CREATE INDEX IF NOT EXISTS "idx_daily_attempt_date_user_initial" ON "daily_attempts" ("date", "userId")'],
      ['CREATE UNIQUE INDEX IF NOT EXISTS "uq_daily_session_initial" ON "daily_attempts" ("date", "userId", "matchSessionId")'],
      ['CREATE INDEX IF NOT EXISTS "idx_dict_rarity_initial" ON "dictionary" ("rarity")'],
      ['CREATE INDEX IF NOT EXISTS "idx_dict_length_initial" ON "dictionary" ("length")'],
      ['CREATE INDEX IF NOT EXISTS "idx_gridpool_avail_initial" ON "grid_pool" ("difficulty", "status")'],
      ['CREATE UNIQUE INDEX IF NOT EXISTS "idx_match_players_match_sid_initial" ON "match_players" ("matchId", "sid")'],
      ['CREATE INDEX IF NOT EXISTS "idx_snapshot_type_period_initial" ON "leaderboard_snapshots" ("type", "period")'],
      ['CREATE UNIQUE INDEX IF NOT EXISTS "uq_snapshot_period_user_initial" ON "leaderboard_snapshots" ("type", "period", "userId")'],
      ['CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_items_user_item_initial" ON "user_items" ("user_id", "item_id")'],
      ['CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_achievements_user_achievement_initial" ON "user_achievements" ("user_id", "achievement_id")'],
      ['CREATE UNIQUE INDEX IF NOT EXISTS "idx_userfoundword_user_word_initial" ON "user_found_words" ("user_id", "word")'],
      ['CREATE UNIQUE INDEX IF NOT EXISTS "idx_userprogress_user_level_initial" ON "user_progress" ("user_id", "level_id")'],
      ['CREATE INDEX IF NOT EXISTS "idx_wordapply_user_initial" ON "word_applies" ("user_id")'],
      ['CREATE INDEX IF NOT EXISTS "idx_wordapply_word_initial" ON "word_applies" ("word")'],
      ['CREATE UNIQUE INDEX IF NOT EXISTS "idx_wordapply_word_user_initial" ON "word_applies" ("word", "user_id")'],
      ['CREATE UNIQUE INDEX IF NOT EXISTS "uq_outbox_dedupe_key_initial" ON "outbox_events" ("dedupeKey")'],
      ['CREATE INDEX IF NOT EXISTS "idx_outbox_pending_initial" ON "outbox_events" ("processedAt", "availableAt")'],
    ] as const
    for (const [sql] of indexes) await queryRunner.query(sql)
  }

  public async down(): Promise<void> {
    // 生产基线不做破坏性回滚；请使用经过演练的反向 migration。
  }
}
