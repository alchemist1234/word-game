import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { WsAdapter } from '@nestjs/platform-ws'
import { AppModule } from './app.module'
import { config } from './common/config'

async function bootstrap() {
  if (config.app.isProduction && config.db.synchronize) {
    throw new Error('生产环境禁止 DB_SYNCHRONIZE，请先运行 migration:run')
  }
  if (config.app.isProduction && !config.jwtSecret) {
    throw new Error('生产环境必须设置 JWT_SECRET')
  }
  const app = await NestFactory.create(AppModule)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.setGlobalPrefix('api')
  app.enableCors({ origin: config.app.corsOrigin })
  app.enableShutdownHooks()
  app.useWebSocketAdapter(new WsAdapter(app))
  await app.listen(config.app.port)
  console.log(`Server running on http://localhost:${config.app.port}`)
  console.log(`WebSocket at ws://localhost:${config.app.port}/api/game/ws`)
}

void bootstrap()
