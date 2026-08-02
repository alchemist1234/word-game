// 音效系统（H5 Web Audio 合成，对齐迭代3详细设计 §8）
// 小程序端 getCtx 返回 null 静默（音频文件留迭代6真机调试，技术债）

let audioCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window !== 'undefined' && 'AudioContext' in window) {
    if (!audioCtx) {
      audioCtx = new window.AudioContext()
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume()
    }
    return audioCtx
  }
  return null
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType = 'sine',
  gain = 0.3,
  delay = 0,
): void {
  const ctx = getCtx()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  const t0 = ctx.currentTime + delay
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
  osc.connect(g)
  g.connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.05)
}

/** 有效词：叮 */
export function playSuccess(): void {
  tone(880, 0.15)
}

/** 成语：编钟双音 */
export function playIdiom(): void {
  tone(523.25, 0.4, 'sine', 0.22)
  tone(784, 0.4, 'sine', 0.18, 0.05)
}

/** 无效词：低沉短音 */
export function playFail(): void {
  tone(110, 0.12, 'square', 0.12)
}

/** 连击递进音阶（频率随连击数升高） */
export function playCombo(combo: number): void {
  const freq = 440 + Math.min(combo, 10) * 55
  tone(freq, 0.15, 'sine', 0.25)
}
