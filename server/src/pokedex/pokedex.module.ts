import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { PokedexService } from './pokedex.service'
import { PokedexController } from './pokedex.controller'
import { AuthModule } from '../auth/auth.module'
import { UserFoundWordEntity } from '../user/user-found-word.entity'
import { DictionaryEntity } from '../dictionary/dictionary.entity'

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([UserFoundWordEntity, DictionaryEntity]),
  ],
  controllers: [PokedexController],
  providers: [PokedexService],
})
export class PokedexModule {}
