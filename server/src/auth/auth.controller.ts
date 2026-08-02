import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './jwt.guard'
import { LoginDto } from './dto/login.dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    if (dto.platform === 'h5') {
      if (!dto.phone) throw new BadRequestException('H5 登录需要手机号')
      return this.authService.loginH5(dto.phone, dto.code)
    }
    if (dto.platform === 'wechat_mp') {
      return this.authService.loginWechatMock(dto.code)
    }
    throw new BadRequestException('不支持的平台')
  }

  @Post('sms-code')
  smsCode(@Body() body: { phone?: string }) {
    if (!body.phone) throw new BadRequestException('需要手机号')
    return this.authService.sendSmsCode(body.phone)
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: { user: { userId: number } }) {
    return this.authService.getUserInfo(req.user.userId)
  }
}
