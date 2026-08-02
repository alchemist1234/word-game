import { IsOptional, IsString, IsIn } from 'class-validator'

export class GetGridDto {
  @IsOptional()
  @IsIn(['easy', 'standard', 'hard'])
  difficulty?: string
}
