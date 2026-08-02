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

@Injectable()
export class PokedexService {
  constructor(
    @InjectRepository(UserFoundWordEntity)
    private readonly foundWordRepo: Repository<UserFoundWordEntity>,
    @InjectRepository(DictionaryEntity)
    private readonly dictRepo: Repository<DictionaryEntity>,
  ) {}

  async getPokedex(userId: number): Promise<{
    words: Array<{
      word: string
      rarity: string
      foundCount: number
      firstFoundAt: Date
    }>
    total: number
    collected: number
  }> {
    const words = await this.foundWordRepo.find({ where: { userId } })
    words.sort(
      (a, b) =>
        (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9),
    )
    const total = await this.dictRepo.count()
    return {
      words: words.map((w) => ({
        word: w.word,
        rarity: w.rarity,
        foundCount: w.foundCount,
        firstFoundAt: w.firstFoundAt,
      })),
      total,
      collected: words.length,
    }
  }
}
