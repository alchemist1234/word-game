import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { JwtModule } from '@nestjs/jwt'
import { UserEntity } from '../user/user.entity'
import { UserAuthEntity } from '../user/user-auth.entity'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { JwtAuthGuard } from './jwt.guard'

const JWT_SECRET = 'wordgame-dev-secret-iterate4'

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, UserAuthEntity]),
    JwtModule.register({
      secret: JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard, AuthService, JwtModule],
})
export class AuthModule {}
