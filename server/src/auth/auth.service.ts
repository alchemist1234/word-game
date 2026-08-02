import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { JwtService } from '@nestjs/jwt'
import { UserEntity } from '../user/user.entity'
import { UserAuthEntity } from '../user/user-auth.entity'

const MOCK_SMS_CODE = '1234' // mock 验证码（技术债 #7，迭代10接真实短信）
const JWT_SECRET = 'wordgame-dev-secret-iterate4' // MVP 默认，生产用环境变量

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(UserAuthEntity)
    private readonly authRepo: Repository<UserAuthEntity>,
    private readonly jwtService: JwtService,
  ) {}

  /** H5 手机号登录（mock 验证码） */
  async loginH5(phone: string, code: string): Promise<LoginResult> {
    if (code !== MOCK_SMS_CODE) {
      throw new UnauthorizedException('验证码错误')
    }
    return this.loginOrCreate('h5', phone, { phone })
  }

  /** 微信小程序登录（mock：code 直接当 openid，无真实 code2session） */
  async loginWechatMock(code: string): Promise<LoginResult> {
    return this.loginOrCreate('wechat_mp', code, {})
  }

  /** 通用登录/注册：查 user_auths，不存在则新建用户 */
  private async loginOrCreate(
    platform: string,
    openid: string,
    extra: { phone?: string },
  ): Promise<LoginResult> {
    let auth = await this.authRepo.findOne({ where: { platform, openid } })
    let user: UserEntity | null = null

    if (auth) {
      user = await this.userRepo.findOne({ where: { id: auth.userId } })
      if (!user) throw new NotFoundException('用户数据缺失')
    } else {
      // 新建用户
      user = this.userRepo.create({
        phone: extra.phone ?? null,
        nickname: '玩家' + Math.floor(Math.random() * 100000).toString(),
      })
      await this.userRepo.save(user)
      auth = this.authRepo.create({ userId: user.id, platform, openid })
      await this.authRepo.save(auth)
    }

    const token = this.jwtService.sign(
      { userId: user.id, platform },
      { secret: JWT_SECRET, expiresIn: '7d' },
    )
    return {
      token,
      user: {
        id: user.id,
        nickname: user.nickname,
        chapterCurrent: user.chapterCurrent,
      },
    }
  }

  /** 获取当前用户信息 */
  async getUserInfo(userId: number): Promise<{
    id: number
    nickname: string | null
    chapterCurrent: number
    coins: number
    diamonds: number
  }> {
    const user = await this.userRepo.findOne({ where: { id: userId } })
    if (!user) throw new NotFoundException('用户不存在')
    return {
      id: user.id,
      nickname: user.nickname,
      chapterCurrent: user.chapterCurrent,
      coins: user.coins,
      diamonds: user.diamonds,
    }
  }

  /** 发送验证码（mock） */
  sendSmsCode(phone: string): { sent: boolean; hint: string } {
    if (!phone || phone.length < 6) {
      throw new BadRequestException('手机号格式不正确')
    }
    // mock：验证码固定 1234，不真正发送
    console.log(`[mock SMS] phone=${phone} code=${MOCK_SMS_CODE}`)
    return { sent: true, hint: 'mock 验证码：1234' }
  }
}

export interface LoginResult {
  token: string
  user: {
    id: number
    nickname: string | null
    chapterCurrent: number
  }
}
