import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DictionaryEntity } from './dictionary.entity'
import { DictionaryService } from './dictionary.service'

@Module({
  imports: [TypeOrmModule.forFeature([DictionaryEntity])],
  providers: [DictionaryService],
  exports: [DictionaryService],
})
export class DictionaryModule {}
