import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WordApplyEntity } from './word-apply.entity'
import { DictionaryEntity } from '../dictionary/dictionary.entity'
import { WordApplyService } from './word-apply.service'
import { WordApplyController } from './word-apply.controller'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionary/dictionary.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([WordApplyEntity, DictionaryEntity]),
    AuthModule,
    DictionaryModule,
  ],
  controllers: [WordApplyController],
  providers: [WordApplyService],
  exports: [WordApplyService],
})
export class WordApplyModule {}
