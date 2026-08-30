import { IsString } from 'class-validator'

export class SubmitDailyDto {
  @IsString()
  matchSessionId!: string
}
