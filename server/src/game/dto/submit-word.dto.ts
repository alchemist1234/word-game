import { IsString, IsArray, ValidateNested, IsInt } from 'class-validator'
import { Type } from 'class-transformer'

export class CellPosDto {
  @IsInt()
  row!: number

  @IsInt()
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
