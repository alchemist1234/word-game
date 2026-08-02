import { Injectable, OnModuleInit } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { DictionaryEntity } from './dictionary.entity'
import { Trie } from '../grid-gen/trie'
import type { DictWord, Rarity } from '../grid-gen/types'

@Injectable()
export class DictionaryService implements OnModuleInit {
  private cache = new Map<string, DictWord>()
  private words: DictWord[] = []
  private trie: Trie | null = null

  constructor(
    @InjectRepository(DictionaryEntity)
    private readonly repo: Repository<DictionaryEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadAll()
  }

  /** 内存查询（同步），O(1) -- 迭代5优化：从 PG 查询改为内存 Map */
  findByWord(word: string): DictWord | null {
    return this.cache.get(word) ?? null
  }

  /** 加载全部词库到内存，构建 Trie（供网格生成）。启动时自动调用，后续从缓存返回 */
  async loadAll(): Promise<{ words: DictWord[]; trie: Trie }> {
    if (this.trie && this.words.length > 0) {
      return { words: this.words, trie: this.trie }
    }
    const entities = await this.repo.find()
    const trie = new Trie()
    const words: DictWord[] = entities.map((e) => ({
      word: e.word,
      length: e.length,
      frequency: e.frequency,
      rarity: e.rarity as Rarity,
      chars: e.chars,
      meaning: e.meaning ?? undefined,
    }))
    for (const w of words) {
      trie.insert(w.word)
      this.cache.set(w.word, w)
    }
    this.words = words
    this.trie = trie
    return { words, trie }
  }
}
