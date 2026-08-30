import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

/**
 * JWT 认证 Guard（对齐迭代4详细设计 §2.3）
 * 从 Authorization: Bearer {token} 验证，注入 req.user = { userId }
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest()
    const authHeader: string | undefined = req.headers?.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('未提供认证 token')
    }
    const token = authHeader.slice(7)
    try {
      const payload = this.jwtService.verify<{ userId: number; platform: string }>(token)
      // bigint 列经 JWT 后 userId 是字符串：统一转数字（对齐 GameGateway Number() 处理，
      // 否则 Map 键类型不一致导致"同一人不在同一场对局"的判断失效，刷新后重复匹配出新对局）
      req.user = { userId: Number(payload.userId), platform: payload.platform }
      return true
    } catch {
      throw new UnauthorizedException('token 无效或已过期')
    }
  }
}
