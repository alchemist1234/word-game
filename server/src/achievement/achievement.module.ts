import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserAchievementEntity } from './user-achievement.entity'
import { UserFoundWordEntity } from '../user/user-found-word.entity'
import { UserEntity } from '../user/user.entity'
import { AchievementService } from './achievement.service'
import { AchievementController } from './achievement.controller'
import { AuthModule } from '../auth/auth.module'
import { EconomyModule } from '../economy/economy.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([UserAchievementEntity, UserFoundWordEntity, UserEntity]),
    AuthModule,
    EconomyModule,
  ],
  controllers: [AchievementController],
  providers: [AchievementService],
  exports: [AchievementService],
})
export class AchievementModule {}
