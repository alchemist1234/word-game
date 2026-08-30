import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ChallengeEntity } from './challenge.entity'
import { ChallengeAttemptEntity } from './challenge-attempt.entity'
import { ChallengeService } from './challenge.service'
import { ChallengeController } from './challenge.controller'
import { GameModule } from '../game/game.module'
import { AuthModule } from '../auth/auth.module'
import { UserEntity } from '../user/user.entity'

@Module({
  imports: [
    GameModule,
    AuthModule,
    TypeOrmModule.forFeature([ChallengeEntity, ChallengeAttemptEntity, UserEntity]),
  ],
  controllers: [ChallengeController],
  providers: [ChallengeService],
  exports: [ChallengeService],
})
export class ChallengeModule {}
