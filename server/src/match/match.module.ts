import { Module, forwardRef } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { MatchService } from './match.service'
import { MatchController } from './match.controller'
import { MatchEntity } from './match.entity'
import { MatchPlayerEntity } from './match-player.entity'
import { UserEntity } from '../user/user.entity'
import { GridPoolModule } from '../grid-pool/grid-pool.module'
import { AuthModule } from '../auth/auth.module'
import { GameModule } from '../game/game.module'

/**
 * 实时 1v1 对战模块（迭代6详细设计 §2.2）
 * GameModule → MatchModule 单向 forwardRef（GameGateway 注入 MatchService）；
 * MatchModule 正常 imports GameModule（MatchService 建会话需 GameService）。
 * 避免双向 forwardRef 造成的模块双实例化（迭代6联调发现）。
 */
@Module({
  imports: [
    forwardRef(() => GameModule),
    GridPoolModule,
    AuthModule,
    TypeOrmModule.forFeature([UserEntity, MatchEntity, MatchPlayerEntity]),
  ],
  controllers: [MatchController],
  providers: [MatchService],
  exports: [MatchService],
})
export class MatchModule {}
