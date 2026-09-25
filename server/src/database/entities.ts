import { ChallengeAttemptEntity } from '../challenge/challenge-attempt.entity'
import { ChallengeEntity } from '../challenge/challenge.entity'
import { DailyAttemptEntity } from '../daily/daily-attempt.entity'
import { DailyChallengeEntity } from '../daily/daily-challenge.entity'
import { DailyRewardClaimEntity } from '../daily/daily-reward-claim.entity'
import { DictionaryEntity } from '../dictionary/dictionary.entity'
import { GameSettlementEntity } from '../game/game-settlement.entity'
import { GridPoolEntity } from '../grid-pool/grid-pool.entity'
import { LeaderboardSnapshotEntity } from '../leaderboard/leaderboard-snapshot.entity'
import { MatchPlayerEntity } from '../match/match-player.entity'
import { MatchEntity } from '../match/match.entity'
import { OutboxEventEntity } from '../outbox/outbox-event.entity'
import { UserAchievementEntity } from '../achievement/user-achievement.entity'
import { UserAuthEntity } from '../user/user-auth.entity'
import { UserFoundWordEntity } from '../user/user-found-word.entity'
import { UserItemEntity } from '../item/user-item.entity'
import { UserProgressEntity } from '../user/user-progress.entity'
import { UserEntity } from '../user/user.entity'
import { WordApplyEntity } from '../word-apply/word-apply.entity'
import { SeasonSettlementEntity } from '../rank/season-settlement.entity'

export const entities = [
  DictionaryEntity,
  GridPoolEntity,
  UserEntity,
  UserAuthEntity,
  UserProgressEntity,
  UserFoundWordEntity,
  MatchEntity,
  MatchPlayerEntity,
  ChallengeEntity,
  ChallengeAttemptEntity,
  DailyChallengeEntity,
  DailyAttemptEntity,
  DailyRewardClaimEntity,
  LeaderboardSnapshotEntity,
  UserItemEntity,
  UserAchievementEntity,
  WordApplyEntity,
  GameSettlementEntity,
  OutboxEventEntity,
  SeasonSettlementEntity,
]
