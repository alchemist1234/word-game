import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { WsAdapter } from '@nestjs/platform-ws'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.setGlobalPrefix('api')
  app.enableCors()
  app.useWebSocketAdapter(new WsAdapter(app))
  await app.listen(3000)
  console.log('Server running on http://localhost:3000')
  console.log('WebSocket at ws://localhost:3000/api/game/ws')
}
bootstrap()
