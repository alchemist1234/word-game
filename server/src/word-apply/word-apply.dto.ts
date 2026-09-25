import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class WordApplyCellDto {
  @IsInt()
  @Min(0)
  row!: number

  @IsInt()
  @Min(0)
  col!: number
}

export class ApplyWordDto {
  @IsString()
  @Matches(/^[\u4e00-\u9fff]{2,6}$/)
  word!: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  matchSessionId?: string

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(36)
  @ValidateNested({ each: true })
  @Type(() => WordApplyCellDto)
  cells?: WordApplyCellDto[]
}
