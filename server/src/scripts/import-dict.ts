import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { dict } from '@node-rs/jieba/dict'
import { DictionaryEntity } from '../dictionary/dictionary.entity'
import { config } from '../common/config'

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
      chars: e.word.split(''),
      meaning: null as string | null,
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
    synchronize: true,
  })
  await ds.initialize()
  const repo = ds.getRepository(DictionaryEntity)

  console.log('清空旧数据...')
  await repo.clear()

  console.log('批量写入...')
  // 分批写入（每 500 条）
  for (let i = 0; i < dictWords.length; i += 500) {
    await repo.save(dictWords.slice(i, i + 500))
  }

  // 统计
  const stats = dictWords.reduce(
    (acc, w) => {
      acc[w.rarity] = (acc[w.rarity] || 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )
  console.log(`导入完成：${dictWords.length} 条`)
  console.log('Rarity 分布:', stats)

  await ds.destroy()
}

main().catch((e) => {
  console.error('导入失败:', e)
  process.exit(1)
})
