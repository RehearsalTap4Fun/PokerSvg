import type { HandEvent } from '../core/events'
import type { AiStyleId, TournamentPlayer } from '../core/types'
import { addCounters, emptyCounters, handStats, type StatCounters } from '../analysis/playerStats'
import { adaptStyle } from '../ai/adapt'
import { STYLES, type AiStyle } from '../ai/styles'

// 对手模型：按座位累计公开行为统计（只在手与手之间更新，保证一手之内推断稳定）。
// AI 座位 → 真实风格（推断即真实条件分布，工具的"上帝视角"卖点）；
// 人类座位 → 以紧凶为先验、按统计收缩推导的动态风格（AI 据此适应你的打法）。

const WINDOW = 200 // 与 GameController.history 上限一致，保证存档恢复后模型相同

export class OpponentModel {
  private samples: Map<number, StatCounters>[] = []
  private totals = new Map<number, StatCounters>()
  private styleCache = new Map<number, AiStyle>()
  private styleIds = new Map<number, AiStyleId | 'human'>()

  constructor(players: readonly TournamentPlayer[]) {
    for (const p of players) this.styleIds.set(p.seat, p.style)
  }

  observeHand(events: readonly HandEvent[]): void {
    const hs = handStats(events)
    this.samples.push(hs)
    for (const [seat, c] of hs) {
      const t = this.totals.get(seat) ?? emptyCounters()
      addCounters(t, c)
      this.totals.set(seat, t)
    }
    if (this.samples.length > WINDOW) {
      const old = this.samples.shift()!
      for (const [seat, c] of old) {
        const t = this.totals.get(seat)
        if (!t) continue
        for (const k of Object.keys(t) as (keyof StatCounters)[]) t[k] -= c[k]
      }
    }
    this.styleCache.clear()
  }

  counters(seat: number): StatCounters {
    return this.totals.get(seat) ?? emptyCounters()
  }

  /**
   * "诚实模式"下的风格：不看任何 AI 的真实参数，只按公开统计以紧凶为先验推导——
   * 真实牌桌上你能对对手做出的最好假设。所有座位一视同仁。
   */
  honestStyleFor(seat: number): AiStyle {
    const key = -1 - seat
    const hit = this.styleCache.get(key)
    if (hit) return hit
    const style = adaptStyle(STYLES.tag, this.counters(seat))
    this.styleCache.set(key, style)
    return style
  }

  /** 该座位在 AI/推断眼中的风格 */
  styleFor(seat: number): AiStyle {
    const hit = this.styleCache.get(seat)
    if (hit) return hit
    const id = this.styleIds.get(seat) ?? 'human'
    const style = id === 'human' ? adaptStyle(STYLES.tag, this.counters(seat)) : STYLES[id]
    this.styleCache.set(seat, style)
    return style
  }
}
