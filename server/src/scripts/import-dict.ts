import 'reflect-metadata'
import { DataSource, IsNull, Not } from 'typeorm'
import { dict } from '@node-rs/jieba/dict'
import { DictionaryEntity } from '../dictionary/dictionary.entity'
import { config } from '../common/config'
import extraMeanings from '../../data/dict-extra.json'

/**
 * 词库导入脚本（对齐迭代2详细设计 §7）
 * 数据源：@node-rs/jieba 的 dict.txt（35万词条，含词频 + 词性 i=成语）
 * 运行：cd server && npx ts-node src/scripts/import-dict.ts
 */

interface RawEntry {
  word: string
  freq: number
  pos: string
}

const EXTRA_MEANINGS = extraMeanings as Record<string, string>

function parseDict(): RawEntry[] {
  const text = Buffer.from(dict).toString('utf-8')
  const entries: RawEntry[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const parts = t.split(/\s+/)
    if (parts.length < 2) continue
    const word = parts[0]
    const freq = parseInt(parts[1], 10)
    const pos = parts[2] || ''
    if (Number.isNaN(freq)) continue
    // 筛选 2-6 字纯中文词语
    if (word.length < 2 || word.length > 6) continue
    if (!/^[\u4e00-\u9fff]+$/.test(word)) continue
    entries.push({ word, freq, pos })
  }
  return entries
}

async function main(): Promise<void> {
  console.log('解析 dict.txt...')
  const entries = parseDict()
  console.log(`共 ${entries.length} 条候选词`)

  // 按词频降序
  entries.sort((a, b) => b.freq - a.freq)
  const maxFreq = entries[0]?.freq ?? 1

  // 选取：成语 7000（≥35%） + 非成语 13000，去重 → 2万
  const idioms = entries.filter((e) => e.pos === 'i').slice(0, 7000)
  const nonIdioms = entries.filter((e) => e.pos !== 'i').slice(0, 13000)
  const seen = new Set<string>()
  const selected: RawEntry[] = []
  for (const e of [...idioms, ...nonIdioms]) {
    if (seen.has(e.word)) continue
    seen.add(e.word)
    selected.push(e)
  }
  console.log(`选中 ${selected.length} 条（成语 ${idioms.length}，普通 ${nonIdioms.length}）`)
  if (selected.length < 20000) {
    throw new Error(`词库不足 20000 条：${selected.length}`)
  }
  const selectedIdiomCount = selected.filter((e) => e.pos === 'i').length
  const idiomRatio = selected.length > 0 ? selectedIdiomCount / selected.length : 0
  if (idiomRatio < 0.35) {
    throw new Error(`成语占比不足 35%：${(idiomRatio * 100).toFixed(2)}%`)
  }

  // 计算 rarity（对齐 GDD §2.4.2：按词频排名百分位）
  // 非成语词按词频降序：前 30% common / 30-60% normal / 后 40% rare；成语单独 idiom
  const nonIdiomOrdered = selected
    .filter((e) => e.pos !== 'i')
    .sort((a, b) => b.freq - a.freq)
  const nonIdiomCount = nonIdiomOrdered.length
  const dictWords = selected.map((e) => {
    let rarity: string
    if (e.pos === 'i') {
      rarity = 'idiom'
    } else {
      const idx = nonIdiomOrdered.indexOf(e)
      const pct = nonIdiomCount > 0 ? idx / nonIdiomCount : 1
      rarity = pct < 0.3 ? 'common' : pct < 0.6 ? 'normal' : 'rare'
    }
    return {
      word: e.word,
      length: e.word.length,
      frequency: e.freq / maxFreq, // 归一化 0~1（展示用，稀有度由 rarity 决定）
      rarity,
      tags: e.pos === 'i' ? ['成语'] : [],
      chars: e.word.split(''),
      meaning: EXTRA_MEANINGS[e.word] ?? null,
    }
  })

  // 连 PG 写入
  console.log('连接 PostgreSQL...')
  const ds = new DataSource({
    type: 'postgres',
    host: config.db.host,
    port: config.db.port,
    username: config.db.username,
    password: config.db.password,
    database: config.db.database,
    entities: [DictionaryEntity],
    synchronize: false,
  })
  await ds.initialize()
  const repo = ds.getRepository(DictionaryEntity)

  const replace = process.argv.includes('--replace')
  if (replace) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('生产环境禁止使用 --replace 清空词库')
    }
    console.log('显式替换模式：清空旧数据...')
    await repo.clear()
  } else {
    console.log('增量模式：保留已有词条（仅补齐缺失释义/标签）')
  }

  console.log('批量写入...')
  // 使用 INSERT ... ON CONFLICT，脚本中断后可安全重跑。
  for (let i = 0; i < dictWords.length; i += 500) {
    const batch = dictWords.slice(i, i + 500)
    const values: string[] = []
    const params: Array<string | number | null> = []
    batch.forEach((word, index) => {
      const base = index * 7
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}::jsonb, $${base + 7})`)
      params.push(
        word.word,
        word.length,
        word.frequency,
        word.rarity,
        JSON.stringify(word.tags),
        JSON.stringify(word.chars),
        word.meaning,
      )
    })
    await repo.query(
      `INSERT INTO dictionary (word, length, frequency, rarity, tags, chars, meaning)
       VALUES ${values.join(', ')}
       ON CONFLICT (word) DO UPDATE SET
         meaning = COALESCE(dictionary.meaning, EXCLUDED.meaning),
         tags = CASE WHEN dictionary.tags = '[]'::jsonb THEN EXCLUDED.tags ELSE dictionary.tags END`,
      params,
    )
  }

  // 统计
  const stats = dictWords.reduce(
    (acc, w) => {
      acc[w.rarity] = (acc[w.rarity] || 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )
  console.log(`导入完成：本次准备 ${dictWords.length} 条`)
  console.log('Rarity 分布:', stats)
  const total = await repo.count()
  const idiomCount = await repo.count({ where: { rarity: 'idiom' } })
  const meaningCount = await repo.count({ where: { meaning: Not(IsNull()) } })
  console.log(`数据库词库总数：${total}，成语：${idiomCount} (${(idiomCount / Math.max(1, total) * 100).toFixed(2)}%)，释义：${meaningCount}`)
  if (total < 20000 || idiomCount / Math.max(1, total) < 0.35 || meaningCount / Math.max(1, total) < 0.8) {
    throw new Error('导入后词库验收未通过')
  }

  await ds.destroy()
}

main().catch((e) => {
  console.error('导入失败:', e)
  process.exit(1)
})
