import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserItemEntity } from './user-item.entity'
import { UserEntity } from '../user/user.entity'
import { ItemService } from './item.service'
import { ItemController } from './item.controller'
import { AuthModule } from '../auth/auth.module'
import { GridPoolModule } from '../grid-pool/grid-pool.module'
import { DictionaryModule } from '../dictionary/dictionary.module'

@Module({
  imports: [TypeOrmModule.forFeature([UserItemEntity, UserEntity]), AuthModule, GridPoolModule, DictionaryModule],
  controllers: [ItemController],
  providers: [ItemService],
  exports: [ItemService],
})
export class ItemModule {}
