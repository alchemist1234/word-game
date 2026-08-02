import { IsString } from 'class-validator'

export class EndGameDto {
  @IsString()
  matchSessionId!: string
}
