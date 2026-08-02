import { IsString, IsIn, IsOptional } from 'class-validator'

export class LoginDto {
  @IsString()
  @IsIn(['h5', 'wechat_mp'])
  platform!: string

  @IsOptional()
  @IsString()
  phone?: string

  @IsString()
  code!: string // H5: 验证码；微信: wx.login 的 code
}
