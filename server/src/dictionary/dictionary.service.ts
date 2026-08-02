import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { DictionaryEntity } from './dictionary.entity'
import { Trie } from '../grid-gen/trie'
import type { DictWord, Rarity } from '../grid-gen/types'

@Injectable()
export class DictionaryService {
  constructor(
    @InjectRepository(DictionaryEntity)
    private readonly repo: Repository<DictionaryEntity>,
  ) {}

  async findByWord(word: string): Promise<DictionaryEntity | null> {
    return this.repo.findOne({ where: { word } })
  }

  /** 加载全部词库到内存，构建 Trie（供网格生成） */
  async loadAll(): Promise<{ words: DictWord[]; trie: Trie }> {
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
    for (const w of words) trie.insert(w.word)
    return { words, trie }
  }
}
