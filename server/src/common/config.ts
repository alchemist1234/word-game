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

export const config = {
  db: {
    type: 'postgres' as const,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'wordgame',
    password: process.env.DB_PASS || 'wordgame',
    database: process.env.DB_NAME || 'wordgame',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  wordApply: {
    threshold: parseInt(process.env.WORD_APPLY_AUTO_MERGE_THRESHOLD || '10', 10),
    dailyLimit: parseInt(process.env.WORD_APPLY_DAILY_LIMIT || '5', 10),
  },
}
