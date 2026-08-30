import { IsString, IsUUID } from 'class-validator'

export class CreateChallengeDto {
  @IsString()
  matchSessionId!: string
}

export class ChallengeIdDto {
  @IsUUID()
  id!: string
}

export class SubmitChallengeDto {
  @IsString()
  matchSessionId!: string
}
