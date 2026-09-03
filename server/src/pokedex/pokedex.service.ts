import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { UserFoundWordEntity } from '../user/user-found-word.entity'
import { DictionaryEntity } from '../dictionary/dictionary.entity'

const RARITY_ORDER: Record<string, number> = {
  idiom: 0,
  rare: 1,
  normal: 2,
  common: 3,
}

const POKEDEX_TITLES = [
  { threshold: 100, title: '初识字海' },
  { threshold: 500, title: '词海泛舟' },
  { threshold: 1000, title: '博览群书' },
  { threshold: 5000, title: '万词户侯' },
]

@Injectable()
export class PokedexService {
  constructor(
    @InjectRepository(UserFoundWordEntity)
    private readonly foundWordRepo: Repository<UserFoundWordEntity>,
    @InjectRepository(DictionaryEntity)
    private readonly dictRepo: Repository<DictionaryEntity>,
  ) {}

  async getPokedex(
    userId: number,
    query?: { groupBy?: string; rarity?: string; tag?: string },
  ): Promise<{
    words: Array<{
      word: string
      rarity: string
      foundCount: number
      firstFoundAt: Date
      meaning?: string | null
      tags?: string[]
      length?: number
    }>
    total: number
    collected: number
    groups?: Array<{
      key: string
      count: number
      words: Array<{
        word: string
        rarity: string
        foundCount: number
        firstFoundAt: Date
        meaning?: string | null
        tags?: string[]
        length?: number
      }>
    }>
  }> {
    const words = await this.foundWordRepo.find({ where: { userId } })
    words.sort(
      (a, b) =>
        (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9),
    )
    const total = await this.dictRepo.count()
    // enrich with meaning/tags/length from dictionary
    const dictMap = new Map<string, DictionaryEntity>()
    if (words.length > 0) {
      const dictWords = await this.dictRepo.find({
        where: words.map((w) => ({ word: w.word } as any)),
      } as any)
      // fallback: load all if IN query not support, but TypeORM find with array uses IN
      // For safety, if not all found, bulk load
      if (dictWords.length < words.length) {
        const all = await this.dictRepo.find()
        for (const d of all) dictMap.set(d.word, d)
      } else {
        for (const d of dictWords) dictMap.set(d.word, d)
      }
    }
    let enriched = words.map((w) => {
      const d = dictMap.get(w.word)
      return {
        word: w.word,
        rarity: w.rarity,
        foundCount: w.foundCount,
        firstFoundAt: w.firstFoundAt,
        meaning: d?.meaning ?? null,
        tags: d?.tags ?? [],
        length: d?.length ?? w.word.length,
      }
    })
    // filter
    if (query?.rarity) enriched = enriched.filter((w) => w.rarity === query.rarity)
    if (query?.tag) enriched = enriched.filter((w) => (w.tags ?? []).includes(query.tag!))

    type EnrichedWord = (typeof enriched)[number]
    let groups: Array<{ key: string; count: number; words: EnrichedWord[] }> | undefined
    if (query?.groupBy) {
      const map = new Map<string, EnrichedWord[]>()
      for (const w of enriched) {
        let key = ''
        if (query.groupBy === 'rarity') key = w.rarity
        else if (query.groupBy === 'length') key = String(w.length ?? w.word.length)
        else if (query.groupBy === 'tag') key = (w.tags && w.tags[0]) || '其他'
        else key = w.rarity
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(w)
      }
      groups = [...map.entries()].map(([key, ws]) => ({ key, count: ws.length, words: ws }))
    }
    return {
      words: enriched,
      total,
      collected: words.length,
      ...(groups ? { groups } : {}),
    }
  }

  async getTitles(userId: number): Promise<{
    titles: Array<{ threshold: number; title: string; unlocked: boolean }>
    collected: number
  }> {
    const collected = await this.foundWordRepo.count({ where: { userId } })
    return {
      collected,
      titles: POKEDEX_TITLES.map((t) => ({ ...t, unlocked: collected >= t.threshold })),
    }
  }
}
