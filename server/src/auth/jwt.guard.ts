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
      req.user = { userId: payload.userId, platform: payload.platform }
      return true
    } catch {
      throw new UnauthorizedException('token 无效或已过期')
    }
  }
}
