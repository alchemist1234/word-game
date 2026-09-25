import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { OutboxEventEntity } from './outbox-event.entity'
import { OutboxService } from './outbox.service'
import { AchievementModule } from '../achievement/achievement.module'
import { FaultInjectionService } from '../common/fault-injection.service'

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEventEntity]), AchievementModule],
  providers: [OutboxService, FaultInjectionService],
  exports: [OutboxService],
})
export class OutboxModule {}
