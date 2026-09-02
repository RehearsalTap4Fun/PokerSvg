import type { HandEvent } from '../core/events'

// 轻量音效：全部用 Web Audio 现场合成（零音频资源，兼容单文件构建）。
// AudioContext 懒创建（浏览器要求用户手势后才能出声，游戏由点击进入，天然满足）。

export type SoundKind = 'deal' | 'flip' | 'chip' | 'chips' | 'allin' | 'knock' | 'fold' | 'win' | 'turn'

const KEY = 'poker-sound-v1'

export class SoundManager {
  enabled: boolean
  private ctx: AudioContext | null = null

  constructor() {
    let saved: string | null = null
    try {
      saved = localStorage.getItem(KEY)
    } catch {
      /* ignore */
    }
    this.enabled = saved !== '0'
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    try {
      localStorage.setItem(KEY, on ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  private ensure(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext()
      } catch {
        return null
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** 短促振荡音：freq→freqEnd 滑音，指数衰减包络 */
  private blip(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, freqEnd?: number): void {
    const ctx = this.ensure()
    if (!ctx) return
    const t0 = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur)
    g.gain.setValueAtTime(gain, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  /** 滤波噪声（洗牌/发牌的"唰"声） */
  private swish(dur: number, gain: number, filterFreq: number, delay = 0): void {
    const ctx = this.ensure()
    if (!ctx) return
    const t0 = ctx.currentTime + delay
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = filterFreq
    filter.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(filter).connect(g).connect(ctx.destination)
    src.start(t0)
  }

  play(kind: SoundKind): void {
    if (!this.enabled) return
    switch (kind) {
      case 'deal':
        this.swish(0.055, 0.1, 2600)
        break
      case 'flip':
        this.swish(0.08, 0.13, 1800)
        this.blip(520, 0.05, 'triangle', 0.05, 0.02, 300)
        break
      case 'chip':
        this.blip(1900, 0.028, 'square', 0.045)
        this.blip(1500, 0.03, 'square', 0.04, 0.035)
        break
      case 'chips':
        this.blip(1900, 0.028, 'square', 0.05)
        this.blip(1600, 0.03, 'square', 0.045, 0.045)
        this.blip(1750, 0.028, 'square', 0.04, 0.09)
        break
      case 'allin':
        this.blip(120, 0.16, 'sine', 0.22, 0, 60)
        for (let i = 0; i < 5; i++) this.blip(1500 + (i % 2) * 350, 0.03, 'square', 0.045, 0.05 + i * 0.04)
        break
      case 'knock':
        this.blip(190, 0.06, 'sine', 0.22, 0, 120)
        this.blip(180, 0.06, 'sine', 0.18, 0.13, 110)
        break
      case 'fold':
        this.swish(0.07, 0.06, 900)
        break
      case 'win':
        this.blip(523, 0.1, 'triangle', 0.11)
        this.blip(659, 0.1, 'triangle', 0.11, 0.08)
        this.blip(784, 0.16, 'triangle', 0.12, 0.16)
        break
      case 'turn':
        this.blip(880, 0.12, 'sine', 0.07, 0, 1100)
        break
    }
  }

  /** 事件 → 音效（ante 等高频小事件不出声） */
  playForEvent(e: HandEvent): void {
    switch (e.t) {
      case 'dealHole':
        this.play('deal')
        break
      case 'street':
        this.play('flip')
        break
      case 'postSB':
      case 'postBB':
        this.play('chip')
        break
      case 'action':
        if (e.action.type === 'fold') this.play('fold')
        else if (e.action.type === 'check') this.play('knock')
        else if (e.allIn) this.play('allin')
        else if (e.action.type === 'call') this.play('chip')
        else this.play('chips')
        break
      case 'showdown':
        if (e.reveal) this.play('flip')
        break
      case 'potAward':
        this.play(e.reason === 'uncalled' ? 'chip' : 'win')
        break
      default:
        break
    }
  }
}
