import { IsString, IsArray, ValidateNested, IsInt, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class CellPosDto {
  @IsInt()
  @Min(0)
  row!: number

  @IsInt()
  @Min(0)
  col!: number
}

export class SubmitWordDto {
  @IsString()
  matchSessionId!: string

  @IsString()
  word!: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CellPosDto)
  cells!: CellPosDto[]
}
