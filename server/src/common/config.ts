import { readFileSync } from 'fs'
import { resolve } from 'path'

// 简单 .env 加载（无依赖，避免引入 dotenv）
try {
  const content = readFileSync(resolve(process.cwd(), '.env'), 'utf-8')
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim()
    if (!process.env[k]) process.env[k] = v
  }
} catch {
  // .env 不存在时忽略，使用环境变量
}

const nodeEnv = process.env.NODE_ENV || 'development'
const isProduction = nodeEnv === 'production'
const dbSynchronize =
  process.env.DB_SYNCHRONIZE === 'true' ||
  (!isProduction && process.env.DB_SYNCHRONIZE !== 'false')

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const config = {
  app: {
    nodeEnv,
    isProduction,
    port: positiveInt(process.env.PORT, 3000),
    corsOrigin: process.env.CORS_ORIGIN || '*',
  },
  jwtSecret: process.env.JWT_SECRET || (isProduction ? '' : 'wordgame-dev-secret-iterate4'),
  db: {
    type: 'postgres' as const,
    host: process.env.DB_HOST || 'localhost',
    port: positiveInt(process.env.DB_PORT, 5432),
    username: process.env.DB_USER || 'wordgame',
    password: process.env.DB_PASS || 'wordgame',
    database: process.env.DB_NAME || 'wordgame',
    synchronize: dbSynchronize,
    migrationsRun: process.env.DB_MIGRATIONS_RUN === 'true',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: positiveInt(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    keyPrefix: process.env.REDIS_KEY_PREFIX || '',
  },
  wordApply: {
    threshold: positiveInt(process.env.WORD_APPLY_AUTO_MERGE_THRESHOLD, 10),
    dailyLimit: positiveInt(process.env.WORD_APPLY_DAILY_LIMIT, 5),
    // P1 安全收口：审核端未上线前默认只进入 pending，不自动污染正式词库。
    autoMergeEnabled: process.env.WORD_APPLY_AUTO_MERGE_ENABLED === 'true',
  },
}