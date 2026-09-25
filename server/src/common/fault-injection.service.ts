import { Injectable } from '@nestjs/common'

/**
 * 仅供测试/演练使用的命名故障点。生产不暴露 HTTP 接口，默认完全 no-op。
 * 通过 FAULT_INJECTION_POINTS 注入，例如 after_effect_before_outbox_ack。
 */
@Injectable()
export class FaultInjectionService {
  private readonly points = new Set(
    (process.env.FAULT_INJECTION_POINTS ?? '')
      .split(',')
      .map((point) => point.trim())
      .filter((point) => point.length > 0),
  )

  async trigger(point: string): Promise<void> {
    if (this.points.has(point)) {
      throw new Error(`fault injection: ${point}`)
    }
  }
}
