import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { GridPoolEntity } from './grid-pool.entity'
import { GridPoolService } from './grid-pool.service'
import { DictionaryModule } from '../dictionary/dictionary.module'

@Module({
  imports: [TypeOrmModule.forFeature([GridPoolEntity]), DictionaryModule],
  providers: [GridPoolService],
  exports: [GridPoolService],
})
export class GridPoolModule {}
